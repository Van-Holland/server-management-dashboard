/**
 * "Something that fails silently is broken" checks.
 *
 * Why this exists: on 2026-10-19 La Haine would not download, and two separate
 * things had been broken for days with nothing on any screen saying so.
 *
 *  - The VPN lost its forwarded port on 2026-10-15. qBittorrent then sat on
 *    listen port 0 / interface `lo`, found no peers, and decluttarr deleted and
 *    blocklisted every torrent it grabbed. Found four days later.
 *  - NZBgeek started answering "IP Address ... Not Approved" on 2026-10-08
 *    (the home IP is dynamic). Prowlarr switched it off, so only torrents were
 *    ever searched. Found eleven days later.
 *
 * Both were visible in one API call each. This module makes those calls on every
 * page load and turns the two known failure shapes into a short list of
 * warnings. It reports only what it can see; an empty list means "nothing wrong
 * that these checks can see", not "everything is fine".
 *
 * An unreachable service is itself a warning, and a missing API key is one too:
 * a check that quietly turns itself off is the same failure as the one it was
 * written to catch.
 */

import { getHostData, warningsFromHost, type HostData } from "@/lib/health-probe"

export type HealthWarning = {
  id: string
  title: string
  detail: string
  /**
   * "alert" (the default) needs action today and goes in the red "Needs attention" box. "maintenance" needs action this
   * week and goes in the calm line under it (added 2026-10-20).
   */
  level?: "alert" | "maintenance"
}

const TIMEOUT_MS = 3000

const QBIT_URL = process.env.QBIT_URL ?? "http://192.168.178.241:8080"
const PROWLARR_URL = process.env.PROWLARR_URL ?? "http://192.168.178.241:9696"

/**
 * An indexer is only reported once it has been failing this long. Prowlarr backs
 * indexers off for a while after any hiccup (The Pirate Bay did it for an hour on
 * the same day), and a banner that appears and clears on its own trains you to
 * ignore it.
 */
const INDEXER_DOWN_AFTER_MS = 60 * 60 * 1000

/**
 * The VPN's forwarded port is renewed about every ten minutes and the renewal
 * fails often: on 2026-10-19 it dropped and came back 11 times in 3 hours, each
 * time within ~20 seconds, while torrents carried on. A banner that flashes red
 * for 20 seconds teaches you to ignore it, so a qBittorrent problem is only
 * reported once it has lasted this long. The real outage of 2026-10-15 lasted
 * four days; ten minutes costs nothing against that.
 *
 * Two minutes until 2026-10-20, when a 24-hour count showed 121 dips (median 40 s,
 * 23 over two minutes, longest 11 minutes), so the box fired about 23 times a day for
 * things that mend themselves. The watchdog (scripts/vpn-watchdog.sh) restarts the
 * VPN stack after ten minutes, so a warning that outlives ten minutes means that failed too.
 *
 * The clock needs memory between page loads, so a small watcher polls qBittorrent
 * in the background and remembers since when it has looked wrong. The env knobs
 * exist so the behaviour can be tested in seconds rather than minutes.
 */
const QBIT_GRACE_MS = Number(process.env.HEALTH_QBIT_GRACE_MS ?? 600_000)
const QBIT_POLL_MS = Number(process.env.HEALTH_QBIT_POLL_MS ?? 30_000)

type QbitPrefs = { listen_port?: number; current_network_interface?: string }
type QbitTransfer = { connection_status?: string }

/**
 * qBittorrent's own state, as gluetun leaves it when VPN port forwarding drops:
 * gluetun's "down" command sets the listen port to 0 and the interface to
 * loopback, which means no peer can ever reach it.
 *
 * `dht_nodes: 0` is deliberately NOT used. An idle qBittorrent with no torrents
 * reports 0 for a minute or more after a perfectly healthy restart, so it would
 * cry wolf. Port 0 and interface `lo` are deterministic.
 */
export function evaluateQbit(prefs: QbitPrefs, transfer: QbitTransfer): HealthWarning[] {
  const warnings: HealthWarning[] = []
  if (prefs.listen_port === 0 || prefs.current_network_interface === "lo") {
    warnings.push({
      id: "qbit-no-port",
      title: "Torrents cannot start: the VPN has no open port",
      detail:
        "qBittorrent is bound to no port (port forwarding in gluetun is down), so it finds no peers and decluttarr " +
        "then deletes every torrent it tries. Restart gluetun, then qbittorrent and slskd (see Linux Home Server hard rule 9).",
    })
  }
  if (transfer.connection_status === "disconnected") {
    warnings.push({
      id: "qbit-disconnected",
      title: "qBittorrent reports no connection",
      detail: "It says it is disconnected from the network. Check the gluetun container and its VPN.",
    })
  }
  return warnings
}

type IndexerStatus = { indexerId: number; disabledTill?: string; initialFailure?: string }

function when(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  })
}

/** Indexers Prowlarr has switched off after a long run of failures. */
export function evaluateIndexers(
  statuses: IndexerStatus[],
  names: Map<number, string>,
  nowMs: number,
): HealthWarning[] {
  const warnings: HealthWarning[] = []
  for (const s of statuses) {
    const disabledTillMs = s.disabledTill ? Date.parse(s.disabledTill) : Number.NaN
    const failingSinceMs = s.initialFailure ? Date.parse(s.initialFailure) : Number.NaN
    if (!Number.isFinite(disabledTillMs) || disabledTillMs <= nowMs) continue
    if (!Number.isFinite(failingSinceMs) || nowMs - failingSinceMs < INDEXER_DOWN_AFTER_MS) continue
    const name = names.get(s.indexerId) ?? `Indexer ${s.indexerId}`
    warnings.push({
      id: `indexer-${s.indexerId}`,
      title: `${name} is switched off in Prowlarr`,
      detail:
        `Failing since ${when(failingSinceMs)}, so Sonarr and Radarr are not searching it. ` +
        `Open Prowlarr, then Indexers, then Test. For NZBgeek the usual cause is a changed home IP: ` +
        `add it under nzbgeek.info, account, api whitelist.`,
    })
  }
  return warnings
}

async function getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

type QbitState = { reachable: boolean; port: number | null; iface: string | null }

async function checkQbit(): Promise<{ warnings: HealthWarning[]; state: QbitState }> {
  try {
    const [prefs, transfer] = await Promise.all([
      getJson<QbitPrefs>(`${QBIT_URL}/api/v2/app/preferences`),
      getJson<QbitTransfer>(`${QBIT_URL}/api/v2/transfer/info`),
    ])
    return {
      warnings: evaluateQbit(prefs, transfer),
      state: { reachable: true, port: prefs.listen_port ?? null, iface: prefs.current_network_interface ?? null },
    }
  } catch (err) {
    return {
      warnings: [
        {
          id: "qbit-unreachable",
          title: "Cannot reach qBittorrent",
          detail: `The dashboard could not read it (${err instanceof Error ? err.message : "no answer"}). It may be down, or its login whitelist changed.`,
        },
      ],
      state: { reachable: false, port: null, iface: null },
    }
  }
}

export type IndexerState = { name: string; ok: boolean }

async function checkProwlarr(): Promise<{ warnings: HealthWarning[]; indexers: IndexerState[] | null }> {
  const key = process.env.PROWLARR_API_KEY
  if (!key) {
    return {
      warnings: [
        {
          id: "prowlarr-no-key",
          title: "Indexer check is not set up",
          detail: "PROWLARR_API_KEY is missing from the dashboard's .env, so a switched-off indexer would go unnoticed.",
        },
      ],
      indexers: null,
    }
  }
  try {
    const headers = { "X-Api-Key": key }
    const [statuses, indexers] = await Promise.all([
      getJson<IndexerStatus[]>(`${PROWLARR_URL}/api/v1/indexerstatus`, headers),
      getJson<{ id: number; name: string }[]>(`${PROWLARR_URL}/api/v1/indexer`, headers),
    ])
    const now = Date.now()
    const off = new Set(statuses.filter((s) => s.disabledTill && Date.parse(s.disabledTill) > now).map((s) => s.indexerId))
    return {
      warnings: evaluateIndexers(statuses, new Map(indexers.map((i) => [i.id, i.name])), now),
      indexers: indexers.map((i) => ({ name: i.name, ok: !off.has(i.id) })),
    }
  } catch (err) {
    return {
      warnings: [
        {
          id: "prowlarr-unreachable",
          title: "Cannot reach Prowlarr",
          detail: `The dashboard could not read it (${err instanceof Error ? err.message : "no answer"}), so indexer problems would go unnoticed.`,
        },
      ],
      indexers: null,
    }
  }
}

type QbitWatch = { warnings: HealthWarning[]; state: QbitState | null; badSince: number | null; started: boolean }

// On globalThis so a hot reload in development cannot start a second timer.
const globalWatch = globalThis as typeof globalThis & { __qbitWatch?: QbitWatch }
const qbitWatch: QbitWatch = (globalWatch.__qbitWatch ??= { warnings: [], state: null, badSince: null, started: false })

async function pollQbit(): Promise<void> {
  const { warnings, state } = await checkQbit()
  qbitWatch.warnings = warnings
  qbitWatch.state = state
  if (warnings.length === 0) qbitWatch.badSince = null
  else if (qbitWatch.badSince === null) qbitWatch.badSince = Date.now()
}

function ensureQbitWatcher(): void {
  if (qbitWatch.started) return
  qbitWatch.started = true
  void pollQbit()
  // unref(): the timer must never be the thing that keeps the server process alive.
  setInterval(() => void pollQbit(), QBIT_POLL_MS).unref()
}

function qbitWarningsPastGrace(): HealthWarning[] {
  if (qbitWatch.badSince === null) return []
  return Date.now() - qbitWatch.badSince >= QBIT_GRACE_MS ? qbitWatch.warnings : []
}

/** Everything the health box, the Health card and the Health page read, gathered once so they can never disagree. */
export type HealthSnapshot = {
  warnings: HealthWarning[]
  qbit: QbitState | null
  indexers: IndexerState[] | null
  host: HostData
  checkedMs: number
}

export async function getHealthSnapshot(): Promise<HealthSnapshot> {
  ensureQbitWatcher()
  // Until the watcher's first poll lands (right after a restart) there is nothing
  // to report; the first real answer arrives within a few seconds.
  const [prowlarr, host] = await Promise.all([checkProwlarr(), getHostData()])
  const nowMs = Date.now()
  return {
    warnings: [...qbitWarningsPastGrace(), ...prowlarr.warnings, ...warningsFromHost(host, nowMs)],
    qbit: qbitWatch.state,
    indexers: prowlarr.indexers,
    host,
    checkedMs: nowMs,
  }
}

export async function getHealthWarnings(): Promise<HealthWarning[]> {
  return (await getHealthSnapshot()).warnings
}
