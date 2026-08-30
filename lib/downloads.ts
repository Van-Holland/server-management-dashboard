export type DownloadItem = {
  name: string
  /** 0-100 */
  progress: number
  bytesPerSec: number
  /** Seconds remaining, or null when the client can't estimate one yet. */
  etaSeconds: number | null
  source: "qBittorrent" | "SABnzbd" | "slskd"
}

export type DownloadsSnapshot = {
  items: DownloadItem[]
  totalBytesPerSec: number
  /** Longest ETA across active items — both clients download in parallel, so
   *  the queue is finished when the slowest item is. */
  etaSeconds: number | null
  /** Per-source failures, so one dead client doesn't blank the whole card. */
  errors: string[]
}

const QBIT_URL = process.env.QBIT_URL ?? "http://192.168.178.241:8080"
const SAB_URL = process.env.SAB_URL ?? "http://192.168.178.241:8081"
// slskd shares gluetun's network namespace, so this port is published by
// gluetun rather than by slskd's own compose file.
const SLSKD_URL = process.env.SLSKD_URL ?? "http://192.168.178.241:5030"
const REQUEST_TIMEOUT_MS = 4000

// qBittorrent reports this when it has no meaningful estimate.
const QBIT_ETA_UNKNOWN = 8640000

function parseTimeLeft(raw: string): number | null {
  // SABnzbd formats as "H:MM:SS", and returns "0:00:00" when idle.
  const parts = raw.split(":").map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null
  const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
  return seconds > 0 ? seconds : null
}

// --- qBittorrent -----------------------------------------------------------
// Two supported modes, and the deployment picks one by whether credentials exist:
//
//   Whitelist (current setup) — qBittorrent's AuthSubnetWhitelist trusts the
//   Docker subnet, so requests need no login at all and no secret lives here.
//   Credentials — set QBIT_USERNAME/QBIT_PASSWORD and it logs in for an SID
//   cookie instead, reusing it rather than re-authenticating on every 2s poll.
let qbitSid: string | null = null

function hasQbitCredentials() {
  return Boolean(process.env.QBIT_USERNAME && process.env.QBIT_PASSWORD)
}

async function qbitLogin(): Promise<string> {
  const username = process.env.QBIT_USERNAME
  const password = process.env.QBIT_PASSWORD
  if (!username || !password) {
    throw new Error("QBIT_USERNAME / QBIT_PASSWORD not set")
  }

  const response = await fetch(`${QBIT_URL}/api/v2/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // qBittorrent rejects cross-site requests unless Referer matches its own
      // address — without this the login returns 403 even with valid credentials.
      Referer: QBIT_URL,
    },
    body: new URLSearchParams({ username, password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  const body = await response.text()
  if (!response.ok || body.trim() !== "Ok.") {
    throw new Error(`login rejected (${response.status})`)
  }

  const sid = response.headers.get("set-cookie")?.match(/SID=([^;]+)/)?.[1]
  if (!sid) throw new Error("login succeeded but returned no SID cookie")
  return sid
}

async function qbitFetch(path: string): Promise<Response> {
  const useCredentials = hasQbitCredentials()
  if (useCredentials && !qbitSid) qbitSid = await qbitLogin()

  const call = () =>
    fetch(`${QBIT_URL}${path}`, {
      headers: {
        ...(qbitSid ? { Cookie: `SID=${qbitSid}` } : {}),
        // qBittorrent rejects cross-site requests unless Referer matches its own
        // address, whitelisted subnet or not.
        Referer: QBIT_URL,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

  let response = await call()
  if (response.status === 403) {
    if (!useCredentials) {
      throw new Error(
        "403 — this host isn't in qBittorrent's AuthSubnetWhitelist; add it, or set QBIT_USERNAME/QBIT_PASSWORD",
      )
    }
    // A stale SID also comes back as 403 — log in again once and retry.
    qbitSid = await qbitLogin()
    response = await call()
  }

  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response
}

type QbitTorrent = { name: string; progress: number; dlspeed: number; eta: number }

async function getQbitDownloads(): Promise<DownloadItem[]> {
  const response = await qbitFetch("/api/v2/torrents/info?filter=downloading")
  const torrents = (await response.json()) as QbitTorrent[]

  return torrents.map((torrent) => ({
    name: torrent.name,
    progress: torrent.progress * 100, // qBittorrent reports 0-1, everything else here is 0-100
    bytesPerSec: torrent.dlspeed,
    etaSeconds: torrent.eta >= QBIT_ETA_UNKNOWN ? null : torrent.eta,
    source: "qBittorrent" as const,
  }))
}

// --- SABnzbd ---------------------------------------------------------------
type SabSlot = { filename: string; percentage: string; timeleft: string; status: string }
type SabQueue = { queue: { slots: SabSlot[]; kbpersec: string } }

async function getSabDownloads(): Promise<DownloadItem[]> {
  const apiKey = process.env.SAB_API_KEY
  if (!apiKey) throw new Error("SAB_API_KEY not set")

  const url = `${SAB_URL}/api?mode=queue&output=json&apikey=${apiKey}`
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const body = await response.text()
  // SABnzbd answers non-local callers with a plain-text refusal, not JSON — see
  // its inet_exposure / local_ranges settings.
  if (body.startsWith("External internet access denied")) {
    throw new Error("refused as external — add this host's subnet to local_ranges")
  }

  const { queue } = JSON.parse(body) as SabQueue
  const slots = queue.slots ?? []
  // The queue speed is reported once for the whole queue, not per slot; SABnzbd
  // downloads one job at a time, so attribute it to whichever slot is active.
  const queueBytesPerSec = Number.parseFloat(queue.kbpersec ?? "0") * 1000

  return slots.map((slot) => {
    const isActive = slot.status === "Downloading"
    return {
      name: slot.filename,
      progress: Number.parseFloat(slot.percentage) || 0,
      bytesPerSec: isActive ? queueBytesPerSec : 0,
      etaSeconds: isActive ? parseTimeLeft(slot.timeleft) : null,
      source: "SABnzbd" as const,
    }
  })
}

// --- slskd (Soulseek) ------------------------------------------------------
type SlskdFile = {
  filename: string
  size: number
  state: string
  bytesTransferred: number
  averageSpeed: number
  bytesRemaining: number
  removed: boolean
}
type SlskdDirectory = { directory: string; fileCount: number; files: SlskdFile[] }
type SlskdUser = { username: string; directories: SlskdDirectory[] }

async function getSlskdDownloads(): Promise<DownloadItem[]> {
  const apiKey = process.env.SLSKD_API_KEY
  if (!apiKey) throw new Error("SLSKD_API_KEY not set")

  const response = await fetch(`${SLSKD_URL}/api/v0/transfers/downloads`, {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const users = (await response.json()) as SlskdUser[]

  // Soulseek queues one FILE at a time, so a 16-track album arrives as 16 rows.
  // Aggregate per directory to match qBittorrent (one row per torrent) and
  // SABnzbd (one row per job) — otherwise a single album floods the card.
  return users.flatMap((user) =>
    user.directories.flatMap((dir) => {
      // Anything "Completed, *" is finished (succeeded, cancelled or errored
      // alike) and does not belong on a card about what is downloading now.
      const active = dir.files.filter((file) => !file.removed && !file.state.startsWith("Completed"))
      if (active.length === 0) return []

      const size = active.reduce((sum, file) => sum + file.size, 0)
      const transferred = active.reduce((sum, file) => sum + file.bytesTransferred, 0)
      const remaining = active.reduce((sum, file) => sum + file.bytesRemaining, 0)
      // averageSpeed is each file's average since it started, not an
      // instantaneous rate, so this total is indicative rather than exact.
      // Queued-but-not-started files report 0, which is what we want.
      const bytesPerSec = active.reduce((sum, file) => sum + file.averageSpeed, 0)

      return [
        {
          // Paths come back Windows-style: "@@user\\Music\\Artist\\Album (1997)".
          name: dir.directory.split("\\").pop() || dir.directory,
          progress: size > 0 ? (transferred / size) * 100 : 0,
          bytesPerSec,
          etaSeconds: bytesPerSec > 0 ? Math.round(remaining / bytesPerSec) : null,
          source: "slskd" as const,
        },
      ]
    }),
  )
}

// --- Combined --------------------------------------------------------------
export async function getDownloads(): Promise<DownloadsSnapshot> {
  const [qbit, sab, slskd] = await Promise.allSettled([
    getQbitDownloads(),
    getSabDownloads(),
    getSlskdDownloads(),
  ])

  const items: DownloadItem[] = []
  const errors: string[] = []

  if (qbit.status === "fulfilled") items.push(...qbit.value)
  else errors.push(`qBittorrent: ${qbit.reason?.message ?? "unreachable"}`)

  if (sab.status === "fulfilled") items.push(...sab.value)
  else errors.push(`SABnzbd: ${sab.reason?.message ?? "unreachable"}`)

  if (slskd.status === "fulfilled") items.push(...slskd.value)
  else errors.push(`slskd: ${slskd.reason?.message ?? "unreachable"}`)

  // Busiest first — the card only has room to name a couple of them.
  items.sort((a, b) => b.bytesPerSec - a.bytesPerSec)

  const etas = items.map((item) => item.etaSeconds).filter((eta): eta is number => eta !== null)

  return {
    items,
    totalBytesPerSec: items.reduce((sum, item) => sum + item.bytesPerSec, 0),
    etaSeconds: etas.length > 0 ? Math.max(...etas) : null,
    errors,
  }
}
