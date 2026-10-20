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
export type CheckGroup = "downloads" | "apps" | "server" | "connection" | "backups" | "other"

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
    ok: (c) => `qBittorrent listens on port ${c.s.qbit?.port} through the VPN (${c.s.qbit?.iface})`,
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
    id: "containers",
    group: "server",
    name: "Containers",
    every: "every 5 minutes",
    looksAt: "Docker's own view of every container: unhealthy or stuck in a restart loop.",
    rule: "Red as soon as one is unhealthy or restarting.",
    fix: "Look at that container's logs.",
    match: starts("unhealthy-", "restarting-"),
    has: (c) => !!c.p,
    ok: (c) => `${c.p?.containers.running ?? "All"} running, none unhealthy or restarting`,
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
    looksAt: "How full the big drive is (media, photos, backups).",
    rule: "Yellow from 80% full, red from 90%.",
    fix: "Free up space, or plan the bigger storage.",
    match: is("disk-hdd"),
    has: (c) => !!c.p?.disks.hdd,
    ok: (c) => `${c.p?.disks.hdd.usedPct}% full`,
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
    ok: (c) => `Nothing waiting. Up ${c.p?.host.uptimeDays} days`,
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
    name: "App versions",
    every: "every 5 minutes",
    looksAt: "Whether Sonarr, Radarr, Lidarr or Prowlarr announce a new version.",
    rule: "Yellow when a new version exists.",
    match: starts("arr-update-"),
    has: (c) => !!c.p,
    ok: () => "All up to date",
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

export type HealthSummary = { status: "ok" | "maintenance" | "alert"; total: number; alerts: number; maintenance: number; unknown: number; text: string }

export function summarize(checks: HealthCheck[]): HealthSummary {
  const alerts = checks.filter((c) => c.status === "alert").length
  const maintenance = checks.filter((c) => c.status === "maintenance").length
  const unknown = checks.filter((c) => c.status === "unknown").length
  const status = alerts > 0 ? "alert" : maintenance > 0 ? "maintenance" : "ok"
  const text =
    alerts > 0
      ? `${alerts} ${alerts === 1 ? "check needs" : "checks need"} attention today`
      : maintenance > 0
        ? `${maintenance} ${maintenance === 1 ? "thing" : "things"} for this week`
        : `All ${checks.length} checks fine`
  return { status, total: checks.length, alerts, maintenance, unknown, text }
}
