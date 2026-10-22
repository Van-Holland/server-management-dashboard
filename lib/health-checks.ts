import type { BackupsSnapshot } from "@/lib/backups"
import type { HealthSnapshot, HealthWarning } from "@/lib/health"
import type { ProbeStatus } from "@/lib/health-probe"

/**
 * The full list of what the dashboard watches (added 2026-10-20), for the Health card and the Health page.
 *
 * The red box and the Maintenance line only show what is WRONG. This catalogue also lists what is fine, with a plain
 * sentence about each check: what it looks at, when it turns yellow or red, and what to do. It is built from the same
 * snapshot the box reads (`getHealthSnapshot`), so the card, the page and the box cannot disagree: a check's status is
 * the worst of the warnings that belong to it.
 *
 * A warning that no check claims still shows up, as its own row under "Other", so nothing the box says can be missing here.
 */

export type CheckStatus = "ok" | "maintenance" | "alert" | "unknown"
export type CheckGroup = "downloads" | "apps" | "containers" | "server" | "connection" | "backups" | "other"

export type HealthCheck = {
  id: string
  group: CheckGroup
  name: string
  status: CheckStatus
  summary: string
  every: string
  looksAt: string
  rule: string
  fix: string | null
  warnings: HealthWarning[]
}

export const GROUPS: { id: CheckGroup; title: string }[] = [
  { id: "downloads", title: "Downloads" },
  { id: "apps", title: "Apps and websites" },
  { id: "containers", title: "Containers" },
  { id: "server", title: "Server" },
  { id: "connection", title: "Connection" },
  { id: "backups", title: "Backups" },
  { id: "other", title: "Other" },
]

type Ctx = { s: HealthSnapshot; p: ProbeStatus | null; backups: BackupsSnapshot | null; nowMs: number }
type Entry = {
  id: string
  group: CheckGroup
  name: string
  every: string
  looksAt: string
  rule: string
  fix?: string
  match: (w: HealthWarning) => boolean
  /** False when the data this check needs is not there: the row then says "unknown" instead of a wrong "fine". */
  has: (c: Ctx) => boolean
  ok: (c: Ctx) => string
}

const starts = (...prefixes: string[]) => (w: HealthWarning) => prefixes.some((p) => w.id.startsWith(p))
const is = (...ids: string[]) => (w: HealthWarning) => ids.includes(w.id)

function ago(iso: string, nowMs: number): string {
  const min = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000))
  if (min < 1) return "just now"
  if (min < 60) return `${min} min ago`
  return `${Math.round(min / 60)} h ago`
}

function day(iso: string | null): string {
  if (!iso) return "unknown"
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Amsterdam" })
}

const CATALOGUE: Entry[] = [
  {
    id: "qbit-port",
    group: "downloads",
    name: "VPN port for torrents",
    every: "every 30 seconds",
    looksAt: "Whether qBittorrent has a forwarded port from the VPN. Without one it finds no peers and downloads stop.",
    rule: "Red when it has had no port for 10 minutes. The VPN watchdog restarts the VPN stack at the same moment. Short drops of under a minute are normal and ignored.",
    fix: "If it does not recover by itself: restart gluetun, then qbittorrent and slskd (Linux Home Server hard rule 9).",
    match: starts("qbit-"),
    has: (c) => !!c.s.qbit?.reachable,
    ok: (c) =>
      c.s.qbit?.port === 0 || c.s.qbit?.iface === "lo"
        ? "No port at this moment. Short drops are normal; it turns red after 10 minutes"
        : `qBittorrent listens on port ${c.s.qbit?.port} through the VPN (${c.s.qbit?.iface})`,
  },
  {
    id: "vpn-watchdog",
    group: "downloads",
    name: "Automatic VPN restart",
    every: "every 2 minutes",
    looksAt: "The watchman script on the server (vpn-watchdog.sh). It restarts the VPN, qBittorrent and slskd when the port stays missing for 10 minutes.",
    rule: "Yellow for 24 hours after it restarted something. Red if a restart did not fix the problem.",
    fix: "If red: restart gluetun, then qbittorrent and slskd by hand.",
    match: (w) => w.id.startsWith("vpn-watchdog") || w.id === "vpn-restarted",
    has: (c) => !!c.s.host.watchdog,
    ok: () => "No restart was needed in the last 24 hours",
  },
  {
    id: "vpn-leak",
    group: "downloads",
    name: "VPN leak",
    every: "every 5 minutes",
    looksAt: "Compares the address the VPN shows to the internet with your home address. They must differ, or torrent traffic is not protected.",
    rule: "Red at once if they are the same.",
    fix: "Stop the torrents and restart gluetun.",
    match: is("vpn-leak"),
    has: (c) => !!c.p?.vpn.checked,
    ok: (c) => `Torrents leave through ${c.p?.vpn.exitIp}, not your home address`,
  },
  {
    id: "home-ip",
    group: "downloads",
    name: "Home IP address",
    every: "every 5 minutes",
    looksAt: "Your home internet address, which your provider changes now and then. NZBgeek only accepts a listed address.",
    rule: "Red for 24 hours after a change, with the steps for NZBgeek.",
    fix: "nzbgeek.info, account, api whitelist: add the new address.",
    match: is("home-ip-changed"),
    has: (c) => !!c.p?.homeIp.lookupOk,
    ok: (c) => `${c.p?.homeIp.current}. ${c.p?.homeIp.changedAtIso ? `Last change ${day(c.p.homeIp.changedAtIso)}` : "No change seen since the check began"}`,
  },
  {
    id: "indexers",
    group: "downloads",
    name: "Search sites",
    every: "each time the page loads",
    looksAt: "Whether Prowlarr has switched a search site off after repeated failures (NZBgeek, 1337x, EZTV, The Pirate Bay).",
    rule: "Red when a site has been failing for more than an hour. Shorter hiccups are normal for the public torrent sites.",
    fix: "Open Prowlarr, Indexers, Test. For NZBgeek the cause is usually a changed home IP.",
    match: starts("indexer-", "prowlarr-"),
    has: (c) => !!c.s.indexers,
    ok: (c) => `${c.s.indexers?.map((i) => i.name).join(", ")} answer`,
  },
  {
    id: "arr-health",
    group: "downloads",
    name: "Sonarr, Radarr, Lidarr, Prowlarr",
    every: "every 5 minutes",
    looksAt: "The health page each of these apps keeps about itself: no search sites, download client unavailable, folder missing, disk space low.",
    rule: "Red when an app reports an error. Warnings go to the Maintenance line. The search-site warning is skipped here because the row above covers it.",
    match: (w) => w.id.startsWith("arr-") && !w.id.startsWith("arr-update-"),
    has: (c) => !!c.p && Object.values(c.p.arr).some((v) => v !== null),
    ok: () => "None of them reports a problem",
  },
  {
    id: "leftovers",
    group: "downloads",
    name: "Leftover downloads",
    every: "every 5 minutes",
    looksAt: "The downloads folder for films, series, music and Soulseek: anything that has sat there for more than a week, anything in failed_imports, and Soulseek files the hourly mover did not take within 2 days.",
    rule: "Yellow (this week) when something is left behind. Work in progress (incomplete downloads, the converter cache, the recycle bin) is skipped.",
    fix: "If the file is already in your library, delete the torrent in qBittorrent with \"delete files\" or ask Claude to remove the folder. If it is not, ask Claude to import it.",
    match: is("leftover-downloads"),
    has: (c) => c.p?.leftovers !== undefined && c.p?.leftovers !== null,
    ok: () => "Nothing is left behind in the downloads folder",
  },
  {
    id: "usenet",
    group: "downloads",
    name: "Usenet (SABnzbd)",
    every: "every 5 minutes",
    looksAt: "Whether SABnzbd answers, and its warnings from the last 24 hours (for example too many connections to the Usenet provider).",
    rule: "Yellow when it has warnings.",
    fix: "For \"too many connections\": lower the connections for that server in SABnzbd, Config, Servers.",
    match: starts("sab-"),
    has: (c) => !!c.p?.sab.ok,
    ok: (c) => `SABnzbd is ${String(c.p?.sab.status).toLowerCase()}, no warnings`,
  },
  {
    id: "disk-ssd",
    group: "server",
    name: "Server SSD space",
    every: "every 5 minutes",
    looksAt: "How full the server's internal SSD is.",
    rule: "Yellow from 80% full, red from 90%.",
    fix: "Free up space before downloads and backups start to fail.",
    match: is("disk-ssd"),
    has: (c) => !!c.p?.disks.ssd,
    ok: (c) => `${c.p?.disks.ssd.usedPct}% full`,
  },
  {
    id: "disk-hdd",
    group: "server",
    name: "8TB drive space",
    every: "every 5 minutes",
    looksAt: "That the big drive (media, photos, backups) is mounted, and how full it is. A USB drive that comes loose would otherwise look like missing data.",
    rule: "Red at once if it is not mounted. Yellow from 80% full, red from 90%.",
    fix: "Free up space, or plan the bigger storage.",
    match: is("disk-hdd", "hdd-missing"),
    has: (c) => c.p?.hddMounted !== false && !!c.p?.disks.hdd,
    ok: (c) => `Mounted, ${c.p?.disks.hdd.usedPct}% full`,
  },
  {
    id: "drive-hdd",
    group: "server",
    name: "8TB drive health",
    every: "every 30 minutes",
    looksAt: "The drive's own SMART report: its pass or fail verdict, bad sectors, temperature. It holds the only copy of your media.",
    rule: "Red if the drive fails its own check or shows any bad sectors, or runs over 60 °C. Yellow from 55 °C.",
    fix: "Back up what matters and plan a replacement.",
    match: (w) => w.id.startsWith("smart-hdd") || w.id === "smart-not-set-up",
    has: (c) => !!c.s.host.hdd,
    ok: (c) => {
      const h = c.s.host.hdd
      const bad = h?.ata_smart_attributes?.table?.find((a) => a.id === 5)?.raw.value ?? 0
      return `Healthy: ${h?.temperature?.current ?? "?"} °C, ${bad} bad sectors, ${h?.power_on_time?.hours ?? "?"} hours of use`
    },
  },
  {
    id: "drive-nvme",
    group: "server",
    name: "Server SSD health",
    every: "every 30 minutes",
    looksAt: "The SSD's own report: critical warnings, media errors, how worn it is, spare cells.",
    rule: "Red on a critical warning or errors, or 90% worn. Yellow from 70% worn.",
    fix: "Plan a replacement.",
    match: starts("smart-nvme"),
    has: (c) => !!c.s.host.nvme,
    ok: (c) => {
      const n = c.s.host.nvme?.nvme_smart_health_information_log
      return `Healthy: ${c.s.host.nvme?.temperature?.current ?? "?"} °C, ${n?.percentage_used ?? "?"}% worn`
    },
  },
  {
    id: "power",
    group: "server",
    name: "Power",
    every: "every 5 minutes",
    looksAt: "Whether the server runs on mains power or on the laptop battery.",
    rule: "Red after 5 minutes on battery.",
    fix: "Check the power cable and the socket.",
    match: is("battery"),
    has: (c) => !!c.p,
    ok: () => "On mains power",
  },
  {
    id: "reboot",
    group: "server",
    name: "Restart",
    every: "every 5 minutes",
    looksAt: "Whether updates to the system core are installed but not active until a restart.",
    rule: "Yellow while a restart is waiting.",
    fix: "Restart when nobody is watching. SSH is back in about a minute.",
    match: is("reboot"),
    has: (c) => !!c.p,
    ok: (c) => `Nothing waiting. Up ${c.p?.host.uptimeDays ? `${c.p.host.uptimeDays} days` : "less than a day"}`,
  },
  {
    id: "updates",
    group: "server",
    name: "Software updates",
    every: "every 5 minutes",
    looksAt: "How many package updates are waiting. Security updates install themselves.",
    rule: "Yellow when any are waiting.",
    match: is("updates"),
    has: (c) => !!c.p,
    ok: () => "None waiting",
  },
  {
    id: "app-versions",
    group: "server",
    name: "Software versions",
    every: "every 12 hours",
    looksAt: "Whether Immich, Sonarr, Radarr, Lidarr, Prowlarr or any other container has a newer version. The arr apps say so themselves; every other container's image is compared with its registry.",
    rule: "Yellow when a newer version exists. Updating is a planned step, not an emergency.",
    fix: "Update one container at a time from its folder under /home/matt/docker. Read the release notes first.",
    match: starts("arr-update-", "image-update"),
    has: (c) => !!c.p?.imageUpdates?.checkedAtIso,
    ok: () => "Everything is up to date",
  },
  {
    id: "memory",
    group: "server",
    name: "Memory",
    every: "every 5 minutes",
    looksAt: "How much of the server's RAM is in use.",
    rule: "Red when it stays over 90% for 10 minutes.",
    fix: "Find the container using too much memory.",
    match: is("ram-high"),
    has: (c) => !!c.p?.resources && c.p.resources.ramPct !== null,
    ok: (c) => `${c.p?.resources?.ramPct}% in use`,
  },
  {
    id: "load",
    group: "server",
    name: "Processor load",
    every: "every 5 minutes",
    looksAt: "How busy the processor has been over the last 15 minutes.",
    rule: "Yellow when it stays far above what the cores can handle for 30 minutes.",
    match: is("load-high"),
    has: (c) => !!c.p?.resources,
    ok: (c) => `Load ${c.p?.resources?.load15} on ${c.p?.resources?.cpus} cores`,
  },
  {
    id: "temperature",
    group: "server",
    name: "Temperature",
    every: "every 5 minutes",
    looksAt: "The hottest temperature sensor inside the server.",
    rule: "Yellow from 75 °C, red from 85 °C.",
    fix: "Check the fan and the airflow.",
    match: is("temp-high"),
    has: (c) => c.p?.resources?.maxTempC != null,
    ok: (c) => `At most ${c.p?.resources?.maxTempC} °C`,
  },
  {
    id: "probe-job",
    group: "server",
    name: "The health check itself",
    every: "every 5 minutes",
    looksAt: "Whether the job on the server that collects all of this is still running. A check that quietly stops is the worst kind.",
    rule: "Red when it has not reported for 20 minutes.",
    fix: "Look at the cron job health-probe.py on mulderserver.",
    match: is("probe-stale", "probe-missing"),
    has: (c) => !!c.p,
    ok: (c) => `Last report ${ago(c.p!.ranAtIso, c.nowMs)}`,
  },
  {
    id: "internet",
    group: "connection",
    name: "Internet connection",
    every: "every minute",
    looksAt: "Whether the server reaches your modem, Ziggo's first gateway and the wider internet. A watcher on the server tests all three every minute and keeps the history, so an outage shows where it broke.",
    rule: "Red when the internet has been down for more than 5 minutes (or the watcher itself has stopped). Yellow for 24 hours after an outage of 5 minutes or more, and when there were 3 or more outages in the last 7 days.",
    fix: "Open the Internet history: it shows each outage with its times and where it broke (your modem, the line or Ziggo, or further out). Show those times to Ziggo.",
    match: starts("internet-"),
    has: (c) => !!c.s.host.internet,
    ok: (c) => {
      const w = c.s.host.internet
      return w ? `Up. ${w.status.outages7d === 0 ? "No outages in the last 7 days" : `${w.status.outages7d} ${w.status.outages7d === 1 ? "outage" : "outages"} in the last 7 days`}` : "Up"
    },
  },
  {
    id: "tailscale",
    group: "connection",
    name: "Tailscale (remote access)",
    every: "every 5 minutes",
    looksAt: "Whether Tailscale is online on the server, and when its key expires. An expired key cuts your remote access.",
    rule: "Yellow from 90 days before the key expires, red from 30 days, red if it is offline.",
    fix: "Tailscale admin console, the machine, Disable key expiry.",
    match: starts("tailscale-"),
    has: (c) => c.p?.tailscale.online != null,
    ok: (c) => `Online. The key is valid until ${day(c.p?.tailscale.keyExpiryIso ?? null)} (${c.p?.tailscale.daysLeft} days)`,
  },
]

function worst(ws: HealthWarning[]): CheckStatus {
  if (ws.some((w) => w.level !== "maintenance")) return "alert"
  if (ws.length > 0) return "maintenance"
  return "ok"
}

export function buildChecks(s: HealthSnapshot, backups: BackupsSnapshot | null, nowMs = Date.now()): HealthCheck[] {
  const p = s.host.probe
  const ctx: Ctx = { s, p, backups, nowMs }
  const claimed = new Set<string>()
  const checks: HealthCheck[] = []

  const fromEntry = (e: Entry) => {
    const ws = s.warnings.filter(e.match)
    ws.forEach((w) => claimed.add(w.id))
    const status: CheckStatus = ws.length > 0 ? worst(ws) : e.has(ctx) ? "ok" : "unknown"
    const summary = ws.length > 0 ? `${ws[0].title}${ws.length > 1 ? ` (+${ws.length - 1} more)` : ""}` : e.has(ctx) ? e.ok(ctx) : "No data yet"
    checks.push({ id: e.id, group: e.group, name: e.name, status, summary, every: e.every, looksAt: e.looksAt, rule: e.rule, fix: e.fix ?? null, warnings: ws })
  }
  CATALOGUE.forEach(fromEntry)

  // One row per app and website the probe knows about.
  for (const a of [...(p?.apps ?? []), ...(p?.sites ?? [])]) {
    const id = `down-${a.name}`
    const ws = s.warnings.filter((w) => w.id === id)
    ws.forEach((w) => claimed.add(w.id))
    const isSite = (p?.sites ?? []).some((x) => x.name === a.name)
    checks.push({
      id,
      group: "apps",
      name: a.name,
      status: ws.length > 0 ? worst(ws) : "ok",
      summary: ws.length > 0 ? ws[0].detail : isSite ? "Reachable from the internet" : "Answers",
      every: "every 5 minutes",
      looksAt: isSite
        ? "Whether this website loads from the internet, through the Cloudflare tunnel."
        : "Whether the app answers on its port on the server.",
      rule: "Red when it has not answered for 5 minutes. A short blip is ignored.",
      fix: isSite ? "Check cloudflared and the container behind it." : "Look at the container's logs.",
      warnings: ws,
    })
  }

  // One chip per container, stopped ones included: a container that is not running is invisible to "unhealthy" and "restarting".
  for (const ctr of p?.containers.all ?? []) {
    const ws = s.warnings.filter((w) => w.id === `stopped-${ctr.name}` || w.id === `unhealthy-${ctr.name}` || w.id === `restarting-${ctr.name}`)
    ws.forEach((w) => claimed.add(w.id))
    checks.push({
      id: `ctr-${ctr.name}`,
      group: "containers",
      name: ctr.name,
      status: ws.length > 0 ? worst(ws) : "ok",
      summary: ws.length > 0 ? ws[0].title : "Running",
      every: "every 5 minutes",
      looksAt: "Docker's own state for this container: running, stopped, restarting or unhealthy.",
      rule: "Red as soon as it is stopped, restarting or unhealthy.",
      fix: "Look at its logs, then start it again.",
      warnings: ws,
    })
  }

  // The background jobs on the server: a job that stopped leaves no error anywhere.
  for (const j of p?.jobs ?? []) {
    const id = `job-${j.name}`
    const ws = s.warnings.filter((w) => w.id === id)
    ws.forEach((w) => claimed.add(w.id))
    checks.push({
      id,
      group: "downloads",
      name: j.name,
      status: ws.length > 0 ? worst(ws) : "ok",
      summary: ws.length > 0 ? ws[0].title : j.ageMin === null ? "No sign yet" : `Active ${j.ageMin < 120 ? `${j.ageMin} min` : `${Math.round(j.ageMin / 60)} h`} ago`,
      every: "every 5 minutes",
      looksAt: "That this job is still running: its log or lock file must have been touched recently.",
      rule: `Red when there is no sign of life for more than ${j.maxMin >= 120 ? `${Math.round(j.maxMin / 60)} hours` : `${j.maxMin} minutes`}.`,
      fix: "Look at the job's cron entry on the server.",
      warnings: ws,
    })
  }

  // Backups come from the backups snapshot, which already judges each job.
  if (backups) {
    const bad = backups.legs.filter((l) => l.verdict !== "ok")
    const status: CheckStatus = backups.worst === "ok" ? "ok" : backups.worst === "late" || backups.worst === "unknown" ? "maintenance" : "alert"
    const w = bad.find((l) => l.verdict === backups.worst) ?? bad[0]
    checks.push({
      id: "backups",
      group: "backups",
      name: "Backup jobs",
      status,
      summary: bad.length === 0 ? `All ${backups.legs.length} backups ran on time` : `${w.name.split(" → ")[0]} needs a look${bad.length > 1 ? ` (+${bad.length - 1} more)` : ""}`,
      every: "each time the page loads",
      looksAt: "The age and result of every backup job, read from each job's own log or status file.",
      rule: "Yellow when a job is late, red when it failed or is far overdue.",
      fix: "Open the Backups page to see which one.",
      warnings: [],
    })
    s.warnings.filter((x) => x.id === "backups").forEach((x) => claimed.add(x.id))
  }

  // Anything the box shows that no check above claimed still gets a row, so the two can never disagree.
  for (const w of s.warnings) {
    if (claimed.has(w.id)) continue
    checks.push({
      id: `other-${w.id}`,
      group: "other",
      name: w.title,
      status: worst([w]),
      summary: w.detail,
      every: "each time the page loads",
      looksAt: "A warning without its own row yet.",
      rule: w.level === "maintenance" ? "Yellow." : "Red.",
      fix: null,
      warnings: [w],
    })
  }
  return checks
}

/**
 * The two lists the home page shows: the red box and the calm Maintenance line. A failed or overdue backup is a red one.
 * One function for both pages, so the box, the Health card and the Health page always count the same things.
 */
export function splitWarnings(s: HealthSnapshot, backups: BackupsSnapshot | null): { alerts: HealthWarning[]; maintenance: HealthWarning[] } {
  const alerts = s.warnings.filter((w) => w.level !== "maintenance")
  const maintenance = s.warnings.filter((w) => w.level === "maintenance")
  if (backups && (backups.worst === "failed" || backups.worst === "overdue")) {
    alerts.push({ id: "backups", title: "A backup job has failed or is overdue", detail: "Open the Backups page to see which one." })
  }
  return { alerts, maintenance }
}

export type HealthSummary = { status: "ok" | "maintenance" | "alert"; total: number; alerts: number; maintenance: number; unknown: number; text: string }

/** The card's line uses the same counts as the box and the Maintenance line (warnings), and the total is the number of checks. */
export function summarize(checks: HealthCheck[], lists: { alerts: HealthWarning[]; maintenance: HealthWarning[] }): HealthSummary {
  const alerts = lists.alerts.length
  const maintenance = lists.maintenance.length
  const unknown = checks.filter((c) => c.status === "unknown").length
  const status = alerts > 0 ? "alert" : maintenance > 0 ? "maintenance" : "ok"
  const text =
    alerts > 0
      ? `${alerts} ${alerts === 1 ? "thing needs" : "things need"} attention today`
      : maintenance > 0
        ? `${maintenance} ${maintenance === 1 ? "thing" : "things"} for this week`
        : `All ${checks.length} checks fine`
  return { status, total: checks.length, alerts, maintenance, unknown, text }
}
