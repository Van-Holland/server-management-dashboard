import { readdir, stat } from "node:fs/promises"
import path from "node:path"

/**
 * What is actually sitting in the recycle bin, and how long it has left.
 *
 * This page has a delete button, and the entire argument for that button being
 * one click rather than three is "the files are recoverable for 7 days". Until
 * now that claim was only ever *printed* — the dialog said the words and
 * nothing on any screen could confirm them. A safety net you cannot look at is
 * a safety net you are taking on trust, which is the same mistake as reading a
 * quality label instead of a bitrate.
 *
 * Everything here is READ-ONLY, and there is deliberately no restore button.
 * Putting a file back is not a file move: Sonarr has to be told to rescan and
 * the episode re-monitored, and a half-done restore looks exactly like a
 * successful one. That belongs behind its own decision, not a stray click.
 */

/**
 * The bin lives on the 8TB drive, which the container mounts separately from
 * `/host/root` — see docker-compose. Overridable so this can be developed
 * against a fake tree on a laptop, the same reasoning as HOST_ROOT in media.ts.
 */
const BIN_PATH = process.env.RECYCLE_BIN_PATH ?? "/host/storage8tb/downloads/.recyclebin"

const TIMEOUT_MS = 6000

export type RecycleBinGroup = {
  name: string
  fileCount: number
  totalBytes: number
  /** When the first file landed here — i.e. when this delete happened. */
  addedMs: number
  /** When the first file in this group gets cleaned up. */
  firstGoesMs: number
  /** When the last one does, i.e. when the folder empties. */
  emptyMs: number
}

export type RecycleBinSnapshot = {
  groups: RecycleBinGroup[]
  totalBytes: number
  fileCount: number
  /**
   * Read live from Sonarr, never hardcoded. If someone changes retention in
   * Sonarr this page must follow it rather than keep printing "7 days" — a
   * countdown that is confidently wrong is worse than no countdown.
   */
  retentionDays: number | null
  path: string
  /** Named, never swallowed — same rule as the rest of this page. */
  error: string | null
}

/** Files can sit in per-series subfolders, so this walks rather than lists. */
async function walk(dir: string): Promise<{ bytes: number; count: number; mtimes: number[] }> {
  let bytes = 0
  let count = 0
  const mtimes: number[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = await walk(full)
      bytes += sub.bytes
      count += sub.count
      mtimes.push(...sub.mtimes)
    } else if (entry.isFile()) {
      const s = await stat(full)
      bytes += s.size
      count += 1
      mtimes.push(s.mtimeMs)
    }
  }
  return { bytes, count, mtimes }
}

/**
 * Retention comes from Sonarr because Sonarr is what performs the cleanup.
 * Radarr has its own identical setting and its own cleanup job, but both point
 * at the same folder with the same value; reading one is enough to display a
 * number, and reading both would invite showing two contradictory countdowns
 * for the same file.
 */
async function retentionFromSonarr(): Promise<number | null> {
  const base = process.env.SONARR_URL ?? "http://192.168.178.241:8989"
  const key = process.env.SONARR_API_KEY
  if (!key) return null
  try {
    const res = await fetch(`${base}/api/v3/config/mediamanagement`, {
      headers: { "X-Api-Key": key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    })
    if (!res.ok) return null
    const cfg = (await res.json()) as { recycleBinCleanupDays?: number }
    const days = cfg.recycleBinCleanupDays
    // 0 means "never clean up" in Sonarr, which is not a 0-day countdown.
    return typeof days === "number" && days > 0 ? days : null
  } catch {
    return null
  }
}

/**
 * Expiry is per FILE, not per folder: Sonarr's cleanup walks the bin and drops
 * anything past its own age. So a folder has two dates worth knowing — when it
 * starts losing files, and when it is finally empty. Collapsing them to one
 * would overstate how long the earliest file has left.
 *
 * `0` stands for "unknown", used when retention could not be read. It is
 * rendered as "unknown" rather than as a date in 1970.
 */
function toGroup(
  name: string,
  bytes: number,
  count: number,
  mtimes: number[],
  retentionDays: number | null,
): RecycleBinGroup {
  const ms = retentionDays === null ? null : retentionDays * 86_400_000
  const oldest = Math.min(...mtimes)
  const newest = Math.max(...mtimes)
  return {
    name,
    fileCount: count,
    totalBytes: bytes,
    addedMs: oldest,
    firstGoesMs: ms === null ? 0 : oldest + ms,
    emptyMs: ms === null ? 0 : newest + ms,
  }
}

export async function getRecycleBin(): Promise<RecycleBinSnapshot> {
  const empty: RecycleBinSnapshot = {
    groups: [],
    totalBytes: 0,
    fileCount: 0,
    retentionDays: null,
    path: BIN_PATH,
    error: null,
  }

  const retentionDays = await retentionFromSonarr()

  let entries
  try {
    entries = await readdir(BIN_PATH, { withFileTypes: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // A missing folder is not a fault: Sonarr creates it on the first delete,
    // so "not there yet" and "nothing deleted yet" are the same state.
    if (code === "ENOENT") return { ...empty, retentionDays }
    return {
      ...empty,
      retentionDays,
      error: `Recycle bin: ${err instanceof Error ? err.message : "unreadable"}`,
    }
  }

  const groups: RecycleBinGroup[] = []
  const looseMtimes: number[] = []
  let looseBytes = 0
  let looseCount = 0

  for (const entry of entries) {
    const full = path.join(BIN_PATH, entry.name)
    try {
      if (entry.isDirectory()) {
        const { bytes, count, mtimes } = await walk(full)
        if (count === 0) continue
        groups.push(toGroup(entry.name, bytes, count, mtimes, retentionDays))
      } else if (entry.isFile()) {
        const s = await stat(full)
        looseBytes += s.size
        looseCount += 1
        looseMtimes.push(s.mtimeMs)
      }
    } catch {
      // One unreadable entry must not blank the whole panel.
      continue
    }
  }

  // Files dumped straight into the bin with no series folder — Radarr does this
  // for movies whose folder name does not survive the move.
  if (looseCount > 0) {
    groups.push(toGroup("(loose files)", looseBytes, looseCount, looseMtimes, retentionDays))
  }

  // Soonest to expire first — the one worth rescuing is the one about to go.
  groups.sort((a, b) => a.emptyMs - b.emptyMs)

  return {
    groups,
    totalBytes: groups.reduce((n, g) => n + g.totalBytes, 0),
    fileCount: groups.reduce((n, g) => n + g.fileCount, 0),
    retentionDays,
    path: BIN_PATH,
    error: null,
  }
}

/** "in 6 days" / "in 14 hours" / "any moment now" — the cleanup job runs once
 *  a day, so sub-day precision would imply an accuracy that does not exist. */
export function timeLeft(expiresMs: number, nowMs: number): string {
  if (expiresMs === 0) return "unknown"
  const hours = (expiresMs - nowMs) / 3_600_000
  if (hours <= 0) return "at the next cleanup"
  if (hours < 24) return `in ${Math.round(hours)}h`
  return `in ${Math.round(hours / 24)} days`
}
