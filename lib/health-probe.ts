import { readFile, stat } from "node:fs/promises"
import type { HealthWarning } from "@/lib/health"

/**
 * The host-level half of "Needs attention" (added 2026-10-20).
 *
 * The dashboard runs in a container and cannot see most of the host, so a small job on the server
 * (`/home/matt/scripts/health-probe.py`, every 5 minutes) collects the facts and writes a JSON file. This module only
 * reads that file and decides what deserves a person's attention. Two levels:
 *
 *   alert        needs action today: the red "Needs attention" box
 *   maintenance  needs action this week: a calm, collapsed line under it
 *
 * Same staleness rule as the backups: if the file is old, that is itself an alert, because a check that quietly stops
 * is the failure the box exists to catch.
 *
 * Drive health (SMART) comes from two other files, written by a root-owned cron job that needs a one-time setup
 * (see the rebuild plan, Linux Home Server). Until it is set up, a maintenance line says so.
 */

const HOST = "/host/root"
const PROBE_FILE = `${HOST}/home/matt/health-probe-status.json`
const WATCHDOG_FILE = `${HOST}/home/matt/vpn-watchdog-status.json`
const SMART_HDD = `${HOST}/var/lib/mulderserver-health/smart-hdd.json`
const SMART_NVME = `${HOST}/var/lib/mulderserver-health/smart-nvme.json`

const PROBE_STALE_MS = 20 * 60 * 1000
const APP_DOWN_AFTER_MS = 5 * 60 * 1000
const BATTERY_AFTER_MS = 5 * 60 * 1000
const IP_CHANGE_SHOWN_MS = 24 * 60 * 60 * 1000
const SMART_STALE_MS = 3 * 60 * 60 * 1000

type Named = { name: string; ok: boolean; code: number | null; downSinceIso: string | null }
type ArrItem = { type: string; message: string }

export type ProbeStatus = {
  ranAtIso: string
  homeIp: { current: string | null; previous: string | null; changedAtIso: string | null; lookupOk: boolean }
  vpn: { exitIp: string | null; checked: boolean; leak: boolean }
  apps: Named[]
  sites: Named[]
  containers: {
    running?: number
    unhealthy: string[]
    restarting: string[]
    stopped?: { name: string; status: string }[]
    all?: { name: string; state: "running" | "stopped" | "restarting" | "unhealthy" }[]
  }
  hddMounted?: boolean
  resources?: { ramPct: number | null; ramHighSinceIso: string | null; load15: number; cpus: number; loadHighSinceIso: string | null; maxTempC: number | null }
  jobs?: { name: string; ok: boolean; ageMin: number | null; maxMin: number }[]
  imageUpdates?: { checkedAtIso: string | null; items: { container: string; image: string; upToDate: boolean | null }[] }
  immich?: { current: string | null; latest: string | null }
  disks: Record<string, { usedPct: number; mount: string }>
  battery: { onBattery: boolean; sinceIso: string | null }
  arr: Record<string, ArrItem[] | null>
  sab: { ok: boolean; status: string | null; warnings: { text: string; count: number }[] }
  tailscale: { online: boolean | null; keyExpiryIso: string | null; daysLeft: number | null }
  host: { rebootRequired: boolean; rebootPkgs: string; updatesPending: number | null; uptimeDays: number }
}

export type WatchdogStatus = { ranAtIso: string; state: string; badSinceIso: string; lastRestartIso: string; dryRun: boolean }

const alert = (id: string, title: string, detail: string): HealthWarning => ({ id, title, detail, level: "alert" })
const maint = (id: string, title: string, detail: string): HealthWarning => ({ id, title, detail, level: "maintenance" })

function when(iso: string | null): string {
  if (!iso) return "an unknown time"
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  })
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function evaluateProbe(p: ProbeStatus, nowMs: number): HealthWarning[] {
  const out: HealthWarning[] = []
  const ageMs = nowMs - Date.parse(p.ranAtIso)
  if (!Number.isFinite(ageMs) || ageMs > PROBE_STALE_MS) {
    out.push(
      alert(
        "probe-stale",
        "The server's health check has stopped",
        `The job that reports on the host (health-probe.py, every 5 minutes) has not reported since ${when(p.ranAtIso)}. Everything below may be out of date.`,
      ),
    )
  }

  // the home IP: NZBgeek only accepts a listed address
  const changedMs = p.homeIp.changedAtIso ? Date.parse(p.homeIp.changedAtIso) : Number.NaN
  if (Number.isFinite(changedMs) && nowMs - changedMs < IP_CHANGE_SHOWN_MS) {
    out.push(
      alert(
        "home-ip-changed",
        "Your home IP address changed",
        `It was ${p.homeIp.previous ?? "unknown"} and is now ${p.homeIp.current ?? "unknown"} (${when(p.homeIp.changedAtIso)}). ` +
          `NZBgeek only accepts a listed address: if Usenet searches stop, add the new one at nzbgeek.info, account, api whitelist.`,
      ),
    )
  }

  if (p.vpn.leak) {
    out.push(
      alert(
        "vpn-leak",
        "The VPN is not protecting torrent traffic",
        "qBittorrent's outside address is the same as your home address. Stop the torrents and restart gluetun (see Linux Home Server hard rule 9).",
      ),
    )
  }

  for (const a of [...p.apps, ...p.sites]) {
    const sinceMs = a.downSinceIso ? Date.parse(a.downSinceIso) : Number.NaN
    if (!a.ok && Number.isFinite(sinceMs) && nowMs - sinceMs >= APP_DOWN_AFTER_MS) {
      out.push(alert(`down-${a.name}`, `${a.name} is not answering`, `It has not answered since ${when(a.downSinceIso)}${a.code ? ` (last reply ${a.code})` : ""}.`))
    }
  }

  // A container that is not running at all is invisible to "unhealthy" and "restarting": that is how soularr sat stopped for 8 days.
  for (const c of p.containers.stopped ?? []) {
    out.push(
      alert(
        `stopped-${c.name}`,
        `${c.name} is not running`,
        `Docker says: ${c.status}. It should be running. Start it with docker start ${c.name} (qbittorrent and slskd: read Linux Home Server hard rule 9 first), or tell Claude it is meant to stay stopped.`,
      ),
    )
  }
  if (p.hddMounted === false) {
    out.push(alert("hdd-missing", "The 8TB drive is not mounted", "Media, photos and the in-house backups are out of reach. Check the USB cable and the drive's power, then mount it (REBUILD.md R4)."))
  }
  for (const c of p.containers.unhealthy) out.push(alert(`unhealthy-${c}`, `${c} reports itself unhealthy`, "Docker's own health check is failing for this container."))
  for (const c of p.containers.restarting) out.push(alert(`restarting-${c}`, `${c} keeps restarting`, "The container starts and stops again and again. Look at its logs."))

  for (const [key, label] of [["ssd", "The server SSD"], ["hdd", "The 8TB drive"]] as const) {
    const d = p.disks[key]
    if (!d) continue
    if (d.usedPct >= 90) out.push(alert(`disk-${key}`, `${label} is almost full (${d.usedPct}%)`, "Free up space before it is full: new downloads and backups will start to fail."))
    else if (d.usedPct >= 80) out.push(maint(`disk-${key}`, `${label} is ${d.usedPct}% full`, "Plan to free up space."))
  }

  // memory, load and temperature only matter when they STAY high
  const r = p.resources
  if (r) {
    const ramMs = r.ramHighSinceIso ? Date.parse(r.ramHighSinceIso) : Number.NaN
    if (Number.isFinite(ramMs) && nowMs - ramMs >= 10 * 60 * 1000) {
      out.push(alert("ram-high", `Memory is almost full (${r.ramPct}%)`, `Over 90% for ${Math.round((nowMs - ramMs) / 60000)} minutes. Apps may start being killed. Look for a container using too much.`))
    }
    const loadMs = r.loadHighSinceIso ? Date.parse(r.loadHighSinceIso) : Number.NaN
    if (Number.isFinite(loadMs) && nowMs - loadMs >= 30 * 60 * 1000) {
      out.push(maint("load-high", "The server has been very busy for 30 minutes", `Load ${r.load15} on ${r.cpus} cores. Transcoding or a runaway process.`))
    }
    if (r.maxTempC !== null && r.maxTempC >= 85) out.push(alert("temp-high", `The server is hot (${r.maxTempC} °C)`, "Check the fan and the airflow."))
    else if (r.maxTempC !== null && r.maxTempC >= 75) out.push(maint("temp-high", `The server is warm (${r.maxTempC} °C)`, "Keep an eye on the fan and the airflow."))
  }

  for (const j of p.jobs ?? []) {
    if (!j.ok) {
      out.push(alert(`job-${j.name}`, `${j.name} has not run`, j.ageMin === null ? "No sign of it at all." : `Its last sign of life was ${j.ageMin} minutes ago; it should be under ${j.maxMin}. Look at its cron job on the server.`))
    }
  }

  const batSince = p.battery.sinceIso ? Date.parse(p.battery.sinceIso) : Number.NaN
  if (p.battery.onBattery && Number.isFinite(batSince) && nowMs - batSince >= BATTERY_AFTER_MS) {
    out.push(alert("battery", "The server is running on battery", `Mains power has been gone since ${when(p.battery.sinceIso)}. The laptop battery will not last long.`))
  }

  // the apps' own health pages
  for (const [app, items] of Object.entries(p.arr)) {
    for (const i of items ?? []) {
      const name = cap(app)
      if (/indexers? unavailable due to failures/i.test(i.message)) continue // covered by the Prowlarr check, which waits an hour on purpose
      if (/update is available/i.test(i.message)) {
        out.push(maint(`arr-update-${app}`, `A new version of ${name} is available`, i.message))
      } else if (i.type === "error") {
        out.push(alert(`arr-${app}-${i.message.slice(0, 24)}`, `${name} reports a problem`, i.message))
      } else {
        out.push(maint(`arr-${app}-${i.message.slice(0, 24)}`, `${name} reports a warning`, i.message))
      }
    }
  }

  // Newer software: the four arr apps say so themselves (above); every other container is compared with its registry once a day.
  const arrWithUpdate = new Set(out.filter((w) => w.id.startsWith("arr-update-")).map((w) => w.id.replace("arr-update-", "")))
  const immichNewer = !!p.immich?.current && !!p.immich?.latest && p.immich.current !== p.immich.latest
  if (immichNewer) {
    out.push(maint("image-update-immich", "Immich has a new version", `Running ${p.immich!.current}, the newest is ${p.immich!.latest}. Update it from /home/matt/docker/immich: docker compose pull, then docker compose up -d. Read its release notes first.`))
  }
  const newer = (p.imageUpdates?.items ?? []).filter(
    (i) => i.upToDate === false && !arrWithUpdate.has(i.container) && !(immichNewer && i.container.startsWith("immich_")),
  )
  if (newer.length > 0) {
    const names = [...new Set(newer.map((i) => i.container))]
    out.push(
      maint(
        "image-updates",
        `${names.length} ${names.length === 1 ? "container has" : "containers have"} a newer version`,
        `${names.join(", ")}. Update one at a time from its folder under /home/matt/docker (docker compose pull, then up -d). gluetun, qbittorrent and slskd: read Linux Home Server hard rule 9 first.`,
      ),
    )
  }

  for (const w of p.sab.warnings) {
    out.push(
      maint(
        `sab-${w.text.slice(0, 24)}`,
        `SABnzbd: ${w.text.replace(/#/g, "…")}`,
        `${w.count} times. For "too many connections" lower the number of connections for that server in SABnzbd, Config, Servers.`,
      ),
    )
  }

  // Tailscale: an expired key would cut remote access
  if (p.tailscale.online === false) out.push(alert("tailscale-offline", "Tailscale is offline on the server", "Remote access (phone, Mac away from home) will not work until it is back."))
  const days = p.tailscale.daysLeft
  if (days !== null) {
    const fix = "Tailscale admin console, the machine, Disable key expiry."
    if (days <= 30) out.push(alert("tailscale-key", `Tailscale's key expires in ${days} days`, `After ${when(p.tailscale.keyExpiryIso)} remote access stops. ${fix}`))
    else if (days <= 90) out.push(maint("tailscale-key", `Tailscale's key expires in ${days} days`, `On ${when(p.tailscale.keyExpiryIso)} remote access would stop. ${fix}`))
  }

  if (p.host.rebootRequired) {
    out.push(
      maint(
        "reboot",
        "A restart is waiting",
        `Updates to the system core are installed but not active yet${p.host.rebootPkgs ? ` (${p.host.rebootPkgs})` : ""}. The server has been up ${p.host.uptimeDays} days. Restart when nobody is watching; SSH is back in about a minute.`,
      ),
    )
  }
  if (p.host.updatesPending && p.host.updatesPending > 0) {
    out.push(maint("updates", `${p.host.updatesPending} software updates are waiting`, "Security updates install themselves; the rest wait for you."))
  }
  return out
}

export function evaluateWatchdog(w: WatchdogStatus, nowMs: number): HealthWarning[] {
  if (w.state === "gave-up") {
    return [alert("vpn-watchdog-gave-up", "The automatic VPN restart did not fix it", "The VPN stack was restarted but qBittorrent still has no port. Restart gluetun, then qbittorrent and slskd by hand.")]
  }
  // The script goes back to "ok" two minutes after a restart but keeps the time of the last one, so go by that time.
  const restartedMs = w.lastRestartIso ? Date.parse(w.lastRestartIso) : Number.NaN
  if (Number.isFinite(restartedMs) && nowMs - restartedMs < 24 * 60 * 60 * 1000) {
    return [maint("vpn-restarted", "The VPN was restarted automatically", `At ${when(w.lastRestartIso)} qBittorrent had been without a port for 10 minutes, so the watchdog restarted gluetun, qBittorrent and slskd. It worked.`)]
  }
  return []
}

type SmartAttr = { id: number; name: string; raw: { value: number } }
export type SmartJson = {
  smart_status?: { passed?: boolean }
  temperature?: { current?: number }
  local_time?: { time_t?: number }
  power_on_time?: { hours?: number }
  ata_smart_attributes?: { table?: SmartAttr[] }
  nvme_smart_health_information_log?: {
    critical_warning?: number
    media_errors?: number
    percentage_used?: number
    available_spare?: number
    available_spare_threshold?: number
    temperature?: number
  }
}

export function evaluateSmart(kind: "hdd" | "nvme", s: SmartJson, nowMs: number): HealthWarning[] {
  const label = kind === "hdd" ? "The 8TB drive" : "The server SSD"
  const out: HealthWarning[] = []
  const t = s.local_time?.time_t ? s.local_time.time_t * 1000 : Number.NaN
  if (!Number.isFinite(t) || nowMs - t > SMART_STALE_MS) {
    out.push(maint(`smart-${kind}-stale`, `${label}: the health reading is old`, "The root job that reads the drive's SMART data has not run for hours."))
  }
  if (s.smart_status?.passed === false) {
    out.push(alert(`smart-${kind}-failed`, `${label} says it is failing`, "The drive's own SMART health check failed. Back up what matters and plan a replacement now."))
  }
  if (kind === "hdd") {
    const attrs = s.ata_smart_attributes?.table ?? []
    for (const id of [5, 197, 198]) {
      const a = attrs.find((x) => x.id === id)
      if (a && a.raw.value > 0) {
        out.push(alert(`smart-hdd-${id}`, `${label} has ${a.raw.value} bad sectors (${a.name.replace(/_/g, " ")})`, "The drive is starting to fail. It is the only copy of your media: plan a replacement."))
      }
    }
    const temp = s.temperature?.current
    if (typeof temp === "number" && temp >= 60) out.push(alert("smart-hdd-temp", `${label} is hot (${temp}°C)`, "Drives above 60°C wear out quickly. Check airflow."))
    else if (typeof temp === "number" && temp >= 55) out.push(maint("smart-hdd-temp", `${label} is warm (${temp}°C)`, "Keep an eye on the airflow around the drive."))
  } else {
    const n = s.nvme_smart_health_information_log
    if (n) {
      if ((n.critical_warning ?? 0) !== 0) out.push(alert("smart-nvme-critical", `${label} reports a critical warning`, "The SSD's own health log shows a critical warning."))
      if ((n.media_errors ?? 0) > 0) out.push(alert("smart-nvme-media", `${label} has ${n.media_errors} media errors`, "The SSD is reporting data errors."))
      if ((n.percentage_used ?? 0) >= 90) out.push(alert("smart-nvme-worn", `${label} is ${n.percentage_used}% worn`, "Plan a replacement."))
      else if ((n.percentage_used ?? 0) >= 70) out.push(maint("smart-nvme-worn", `${label} is ${n.percentage_used}% worn`, "Plan a replacement some time this year."))
      if (n.available_spare !== undefined && n.available_spare_threshold !== undefined && n.available_spare < n.available_spare_threshold) {
        out.push(alert("smart-nvme-spare", `${label} is running out of spare cells`, "Plan a replacement."))
      }
    }
  }
  return out
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T
  } catch {
    return null
  }
}

export type HostData = {
  probe: ProbeStatus | null
  watchdog: WatchdogStatus | null
  hdd: SmartJson | null
  nvme: SmartJson | null
  smartDirExists: boolean
}

/** Reads the four files the server's jobs write. Judging them is `warningsFromHost`, so the Health page can show the raw facts too. */
export async function getHostData(): Promise<HostData> {
  const [probe, watchdog, hdd, nvme, smartDirExists] = await Promise.all([
    readJson<ProbeStatus>(PROBE_FILE),
    readJson<WatchdogStatus>(WATCHDOG_FILE),
    readJson<SmartJson>(SMART_HDD),
    readJson<SmartJson>(SMART_NVME),
    stat(`${HOST}/var/lib/mulderserver-health`).then(() => true).catch(() => false),
  ])
  return { probe, watchdog, hdd, nvme, smartDirExists }
}

export function warningsFromHost(d: HostData, nowMs: number): HealthWarning[] {
  const out: HealthWarning[] = []
  if (!d.probe) {
    out.push(alert("probe-missing", "The server's health check is not running", "No status file from health-probe.py. Check the cron job on mulderserver (every 5 minutes)."))
  } else {
    out.push(...evaluateProbe(d.probe, nowMs))
  }
  if (d.watchdog) out.push(...evaluateWatchdog(d.watchdog, nowMs))
  if (!d.hdd && !d.nvme) {
    out.push(
      maint(
        "smart-not-set-up",
        "Drive health is not monitored yet",
        d.smartDirExists
          ? "The SMART files are missing. Check the root cron job /etc/cron.d/mulderserver-smart."
          : "smartmontools and its root cron job are not set up. The 8TB drive holds the only copy of your media; see the Linux Home Server to-do.",
      ),
    )
  } else {
    if (d.hdd) out.push(...evaluateSmart("hdd", d.hdd, nowMs))
    else out.push(maint("smart-hdd-missing", "The 8TB drive's health reading is missing", "Check the root cron job /etc/cron.d/mulderserver-smart."))
    if (d.nvme) out.push(...evaluateSmart("nvme", d.nvme, nowMs))
  }
  return out
}
