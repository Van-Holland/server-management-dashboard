import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type SpeedtestResult = {
  downloadMbps: number
  uploadMbps: number
  pingMs: number
  /** ISO timestamp of when the test finished. */
  ranAt: string
}

export type SpeedtestState = {
  latest: SpeedtestResult | null
  running: boolean
  /** Set when the last attempt failed, so the card can say why. */
  error: string | null
}

const CACHE_PATH = process.env.SPEEDTEST_CACHE_PATH ?? "/cache/speedtest.json"

// A speedtest saturates the connection for ~30s, which would stall Jellyfin
// streams and downloads. The dashboard is on the tailnet with no login, so the
// button is rate-limited rather than trusted to be pressed sensibly.
const MIN_INTERVAL_MS = Number(process.env.SPEEDTEST_MIN_INTERVAL_MS ?? 15 * 60 * 1000)
const RUN_TIMEOUT_MS = 120_000

// Module-level, so concurrent viewers pressing the button share one run instead
// of each starting their own. Lives only as long as the process, which is fine —
// the worst case after a restart is one extra test.
let inFlight: Promise<SpeedtestResult> | null = null
let lastError: string | null = null

async function readCache(): Promise<SpeedtestResult | null> {
  try {
    return JSON.parse(await readFile(CACHE_PATH, "utf-8")) as SpeedtestResult
  } catch {
    // No cache yet, or it's unreadable — treated the same: nothing to show.
    return null
  }
}

async function writeCache(result: SpeedtestResult): Promise<void> {
  await mkdir(dirname(CACHE_PATH), { recursive: true })
  await writeFile(CACHE_PATH, JSON.stringify(result), "utf-8")
}

type OoklaOutput = {
  ping: { latency: number }
  // Ookla reports bandwidth in BYTES per second, despite the name.
  download: { bandwidth: number }
  upload: { bandwidth: number }
}

async function runSpeedtest(): Promise<SpeedtestResult> {
  const { stdout } = await execFileAsync(
    "speedtest",
    ["--accept-license", "--accept-gdpr", "--format=json"],
    { timeout: RUN_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
  )

  const parsed = JSON.parse(stdout) as OoklaOutput
  const toMbps = (bytesPerSec: number) => Math.round((bytesPerSec * 8) / 100_000) / 10

  const result: SpeedtestResult = {
    downloadMbps: toMbps(parsed.download.bandwidth),
    uploadMbps: toMbps(parsed.upload.bandwidth),
    pingMs: Math.round(parsed.ping.latency * 10) / 10,
    ranAt: new Date().toISOString(),
  }

  await writeCache(result)
  return result
}

export async function getSpeedtestState(): Promise<SpeedtestState> {
  return { latest: await readCache(), running: inFlight !== null, error: lastError }
}

export async function triggerSpeedtest(): Promise<
  { status: "started" | "already-running" } | { status: "too-soon"; retryAfterSeconds: number }
> {
  if (inFlight) return { status: "already-running" }

  const cached = await readCache()
  if (cached) {
    const elapsedMs = Date.now() - new Date(cached.ranAt).getTime()
    if (elapsedMs < MIN_INTERVAL_MS) {
      return {
        status: "too-soon",
        retryAfterSeconds: Math.ceil((MIN_INTERVAL_MS - elapsedMs) / 1000),
      }
    }
  }

  lastError = null
  inFlight = runSpeedtest()
  // Deliberately not awaited: the POST returns immediately and the card picks
  // the result up on its next poll, rather than holding a request open for 30s.
  inFlight
    .catch((error: unknown) => {
      lastError = error instanceof Error ? error.message : String(error)
    })
    .finally(() => {
      inFlight = null
    })

  return { status: "started" }
}
