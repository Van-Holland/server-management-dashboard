import { open, readdir, readFile, stat } from "node:fs/promises"

/**
 * Backup monitoring.
 *
 * The point of this module is narrow and worth stating, because it is easy to
 * build the wrong thing here: it reports whether each backup job RAN, not
 * whether the data it wrote is restorable. Those are different claims. A job
 * can finish cleanly and still have written something useless — that failure
 * mode is only caught by an actual restore test, never by a dashboard.
 *
 * This exists because on 2026-08-13 the Portfolio Performance mirror was found
 * to have been silently doing nothing for three days while reporting success.
 * Every leg below had the same blind spot; none of them could fail visibly.
 */

export type BackupVerdict = "ok" | "late" | "overdue" | "failed" | "unknown"

export type BackupLeg = {
  id: string
  /** Full name, never abbreviated — "VHPM" has been confused with the company. */
  name: string
  /** What data this protects, in plain terms. */
  protects: string
  /** Where the copy lands. */
  destination: string
  /** True if the copy leaves the house. Local copies do not survive fire/theft. */
  offsite: boolean
  schedule: string
  lastRunMs: number | null
  ageHours: number | null
  verdict: BackupVerdict
  /** Short result line from the job itself, e.g. "49 files, 10.541 MiB". */
  detail: string | null
  /** Why the verdict is what it is — always populated for anything but "ok". */
  note: string | null
  /**
   * How the note should read, independent of the verdict. A run can finish on
   * time (verdict "ok") and still have logged real errors — and rendering that
   * warning in the verdict's green was exactly the "a problem that looks fine"
   * failure this page exists to prevent.
   */
  noteTone: "neutral" | "warn"
}

export type BackupsSnapshot = {
  legs: BackupLeg[]
  worst: BackupVerdict
  checkedMs: number
  /** When a restore was last actually performed and verified, or null if never.
   *  Deliberately not a leg — it is a property of the whole system, not of any
   *  single job. A date rather than a boolean so the badge can re-arm itself:
   *  a restore proven once in 2026 says nothing about 2028. */
  restoreTestedMs: number | null
}

/** How long a proven restore stays convincing. Past this the badge comes back
 *  on its own — nobody will remember to re-raise it by hand. */
export const RESTORE_TEST_MAX_AGE_MS = 183 * 24 * 60 * 60 * 1000

const HOST = "/host/root"
const RCLONE_LOG = `${HOST}/home/matt/rclone-backup.log`
const VHPM_LOG = `${HOST}/home/matt/vhpm-dashboard-backup.log`
const TIMEMACHINE = "/host/storage8tb/backups/timemachine"
const STATUS_DIR = `${HOST}/home/matt/backup-status`

/** Both logs are append-only and never rotated — the rclone one is already
 *  ~400 KB and grows every night. Only the tail is ever needed, so never pull
 *  the whole file into memory on a 2-second poll. */
const TAIL_BYTES = 64 * 1024

async function readTail(path: string, bytes = TAIL_BYTES): Promise<string | null> {
  let handle
  try {
    handle = await open(path, "r")
    const { size } = await handle.stat()
    const start = Math.max(0, size - bytes)
    const buffer = Buffer.alloc(Math.min(bytes, size))
    await handle.read(buffer, 0, buffer.length, start)
    return buffer.toString("utf-8")
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

function hoursSince(ms: number | null): number | null {
  if (ms === null) return null
  return (Date.now() - ms) / 3_600_000
}

/**
 * Age thresholds are per-leg because the jobs have genuinely different
 * cadences and different excuses for being late. Time Machine gets a long
 * rope: the MacBook leaves the house, and "laptop was elsewhere" is not a
 * backup failure. The nightly cron jobs get a short one — they run on a
 * machine that is always on, so late means broken.
 */
function judge(ageHours: number | null, lateAfter: number, overdueAfter: number): BackupVerdict {
  if (ageHours === null) return "unknown"
  if (ageHours >= overdueAfter) return "overdue"
  if (ageHours >= lateAfter) return "late"
  return "ok"
}

// ---------------------------------------------------------------------------
// Leg 1 + 2: the two rclone cron jobs, read from their own logs.
// ---------------------------------------------------------------------------

/** rclone's own timestamp format: `2026/08/13 03:13:23`. Parsed as local time,
 *  which is what cron used to write it. */
const RCLONE_TS = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/

function lastRcloneTimestamp(log: string): number | null {
  const lines = log.split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = RCLONE_TS.exec(lines[i])
    if (!m) continue
    const [, y, mo, d, h, mi, s] = m
    return new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime()
  }
  return null
}

/** The closing summary block rclone prints per run:
 *    Transferred:   	   10.541 MiB / 10.541 MiB, 100%, ...
 *    Transferred:           49 / 49, 100%
 *  The first is bytes, the second is a file count. Both are called
 *  "Transferred", which is why they are matched by shape and not by label. */
function rcloneSummary(log: string): string | null {
  const size = [...log.matchAll(/^Transferred:\s+([\d.]+ [KMGT]?i?B) \//gm)].pop()
  const files = [...log.matchAll(/^Transferred:\s+(\d+) \/ (\d+), \d+%\s*$/gm)].pop()
  if (!size && !files) return null
  const parts: string[] = []
  if (files) parts.push(`${files[1]} file${files[1] === "1" ? "" : "s"}`)
  if (size) parts.push(size[1])
  return parts.join(", ")
}

/**
 * Counts rclone ERROR lines belonging to the LAST run only.
 *
 * Two things this has to get right, both learned the hard way:
 *
 * 1. A bare /error/i match also hits filenames and INFO text, so the line must
 *    be anchored to rclone's own `<timestamp> ERROR :` shape.
 * 2. The 64KB tail spans several nights. Counting the whole tail reports last
 *    week's errors as though they happened tonight, so only lines within the
 *    run window (2h back from the last activity — runs take ~15 min and are
 *    nightly, so this captures exactly one) are counted.
 *
 * The recovered token-refresh 401 is excluded deliberately. Proton's access
 * token expires between nightly runs, so rclone's first request 401s, refreshes
 * and carries on — observed at 03:00:04 on consecutive nights, with both runs
 * completing normally. Surfacing that every single day would be noise, and a
 * page that cries wolf nightly is one you stop reading. Anything that is NOT
 * this pattern still shows.
 */
const RECOVERED_TOKEN_401 = /proton drive root link ID.*40[13].*(Invalid access token|Unauthorized)/i

function rcloneErrors(log: string, lastRunMs: number | null): number {
  const windowStart = lastRunMs === null ? 0 : lastRunMs - 2 * 3_600_000
  let count = 0

  for (const line of log.split("\n")) {
    if (!/^\d{4}\/\d{2}\/\d{2} [\d:]+ ERROR\s*:/.test(line)) continue
    if (RECOVERED_TOKEN_401.test(line)) continue

    const m = RCLONE_TS.exec(line)
    if (!m) continue
    const [, y, mo, d, h, mi, s] = m
    const ts = new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime()
    if (ts >= windowStart) count++
  }

  return count
}

async function protonToHdd(): Promise<BackupLeg> {
  const log = await readTail(RCLONE_LOG)
  const lastRunMs = log ? lastRcloneTimestamp(log) : null
  const age = hoursSince(lastRunMs)
  const errors = log ? rcloneErrors(log, lastRunMs) : 0

  let verdict = judge(age, 27, 36)
  let note: string | null = null
  let noteTone: "neutral" | "warn" = "neutral"
  if (!log) {
    verdict = "unknown"
    note = "Log file unreadable — the job's status cannot be established either way."
    noteTone = "warn"
  } else if (verdict === "overdue") {
    note = "Has not run since well past its scheduled window. Check cron and the Proton token."
    noteTone = "warn"
  } else if (verdict === "late") {
    note = "Later than its 03:00 slot but not yet alarming."
    noteTone = "warn"
  } else if (errors > 0) {
    note = `Ran and finished, but logged ${errors} error${errors === 1 ? "" : "s"} on this run.`
    noteTone = "warn"
  }

  return {
    id: "proton-to-hdd",
    name: "Proton Drive → 8TB drive",
    protects: "Everything in Proton Drive, including the whole vault",
    destination: "/mnt/storage8tb/documents/Backup Proton",
    offsite: false,
    schedule: "Nightly, 03:00",
    lastRunMs,
    ageHours: age,
    verdict,
    detail: log ? rcloneSummary(log) : null,
    note,
    noteTone,
  }
}

/** This script brackets each run with explicit markers, so unlike the bare
 *  rclone job above it can distinguish "finished" from "started and died". */
async function vanHollandToProton(): Promise<BackupLeg> {
  const log = await readTail(VHPM_LOG)

  const completed = log ? [...log.matchAll(/^=== (\S+) VHPM dashboard backup complete ===/gm)].pop() : null
  const started = log ? [...log.matchAll(/^=== (\S+) starting VHPM dashboard backup ===/gm)].pop() : null

  const lastRunMs = completed ? new Date(completed[1]).getTime() : null
  const startedMs = started ? new Date(started[1]).getTime() : null
  const age = hoursSince(lastRunMs)

  let verdict = judge(age, 27, 36)
  let note: string | null = null
  const noteTone = "warn" as const

  if (!log) {
    verdict = "unknown"
    note = "Log file unreadable — the job's status cannot be established either way."
  } else if (startedMs !== null && (lastRunMs === null || startedMs > lastRunMs)) {
    // `set -euo pipefail` means a mid-run failure kills the script before it
    // can write its closing marker. A start with no matching finish is the
    // one shape that proves a failure rather than merely suggesting staleness.
    verdict = "failed"
    note = "Started but never wrote its completion marker — the last run died partway."
  } else if (verdict === "overdue") {
    note = "Has not completed since well past its scheduled window."
  } else if (verdict === "late") {
    note = "Later than its 02:00 slot but not yet alarming."
  }

  return {
    id: "vanholland-to-proton",
    name: "Van Holland Property Management → Proton Drive",
    protects: "Tenant documents and the dashboard database",
    destination: "protondrive:3. Backup/VHPM Dashboard",
    offsite: true,
    schedule: "Nightly, 02:00",
    lastRunMs,
    ageHours: age,
    verdict,
    detail: null,
    note,
    noteTone,
  }
}

// ---------------------------------------------------------------------------
// Leg 3: Time Machine, judged by the sparsebundle's own mtime.
// ---------------------------------------------------------------------------

/**
 * There is no log to read — Time Machine runs on the MacBook and writes to a
 * Samba share here. The sparsebundle directory's mtime moves whenever a new
 * band is written, which makes it a sound "did it write" signal.
 *
 * What it explicitly does NOT prove: that the sparsebundle is intact. Network
 * Time Machine sparsebundles corrupt, and that only surfaces on restore.
 */
async function timeMachine(): Promise<BackupLeg> {
  let lastRunMs: number | null = null
  let note: string | null = null
  const noteTone = "warn" as const

  try {
    const names = await readdir(TIMEMACHINE)
    const bundles = names.filter((n) => n.endsWith(".sparsebundle"))
    for (const bundle of bundles) {
      const info = await stat(`${TIMEMACHINE}/${bundle}`)
      const ms = info.mtimeMs
      if (lastRunMs === null || ms > lastRunMs) lastRunMs = ms
    }
    if (bundles.length === 0) note = "No sparsebundle found on the share at all."
  } catch {
    note = "Time Machine share unreadable."
  }

  const age = hoursSince(lastRunMs)
  // Deliberately generous: the MacBook is portable, so a gap usually means it
  // was away from the network, not that backups are broken.
  let verdict = judge(age, 12, 72)
  if (lastRunMs === null) verdict = "unknown"

  if (!note) {
    if (verdict === "overdue") note = "No write in 3 days. If the MacBook has been home, this is broken."
    else if (verdict === "late") note = "No recent write — normal if the MacBook has been away."
  }

  return {
    id: "time-machine",
    name: "MacBook Time Machine → 8TB drive",
    protects: "The whole MacBook",
    destination: "/mnt/storage8tb/backups/timemachine",
    offsite: false,
    schedule: "Hourly, when on the network",
    lastRunMs,
    ageHours: age,
    verdict,
    detail: null,
    note,
    noteTone,
  }
}

// ---------------------------------------------------------------------------
// Legs 4 + 5: reported by the Mac, because they run there and not here.
// ---------------------------------------------------------------------------

type VaultStatus = {
  ranAtIso?: string
  mirrorStatus?: string
  rsyncExit?: number
  vaultPushed?: boolean
  lastCommit?: string
  filesTransferred?: number
}

/**
 * `/save-vault` writes this file into the vault; Proton Drive syncs it up
 * within minutes, and an hourly cron here pulls that one small file back down.
 *
 * The staleness of this file IS the signal. If `/save-vault` stops being run,
 * nothing overwrites it and it ages into "overdue" on its own — no extra
 * liveness machinery needed, and no inbound endpoint on a server that already
 * sits behind a public tunnel.
 */
async function readVaultStatus(): Promise<VaultStatus | null> {
  try {
    return JSON.parse(await readFile(`${STATUS_DIR}/backup-status.json`, "utf-8")) as VaultStatus
  } catch {
    return null
  }
}

function vaultToGithub(status: VaultStatus | null): BackupLeg {
  const lastRunMs = status?.ranAtIso ? new Date(status.ranAtIso).getTime() : null
  const age = hoursSince(lastRunMs)

  // Days, not hours: this one is hand-run, so a quiet weekend is not a fault.
  let verdict = judge(age, 72, 168)
  let note: string | null = null

  if (!status) {
    verdict = "unknown"
    note = "No status file yet — /save-vault has not written one since this was set up."
  } else if (status.vaultPushed === false) {
    verdict = "failed"
    note = "Last run did not reach GitHub."
  } else if (verdict === "overdue") {
    note = "Over a week since the vault reached GitHub. Run /save-vault."
  } else if (verdict === "late") {
    note = "A few days since the last push."
  }

  return {
    id: "vault-to-github",
    name: "Second Brain vault → GitHub",
    protects: "Every note, with full version history",
    destination: "GitHub (private repository)",
    offsite: true,
    schedule: "Manual — whenever /save-vault or /end is run",
    lastRunMs,
    ageHours: age,
    verdict,
    detail: status?.lastCommit ?? null,
    note,
    noteTone: "warn",
  }
}

function portfolioMirror(status: VaultStatus | null): BackupLeg {
  const lastRunMs = status?.ranAtIso ? new Date(status.ranAtIso).getTime() : null
  const age = hoursSince(lastRunMs)

  let verdict = judge(age, 72, 168)
  let note: string | null = null

  const mirror = status?.mirrorStatus?.toUpperCase()

  if (!status) {
    verdict = "unknown"
    note = "No status file yet — /save-vault has not written one since this was set up."
  } else if (mirror === "FAILED") {
    verdict = "failed"
    note = "The mirror did NOT happen. This is the exact failure that went unnoticed for three days."
  } else if (mirror === "UNVERIFIED") {
    // Kept distinct from "ok" on purpose: matching size and mtime is rclone's
    // own skip heuristic, not evidence the bytes match.
    verdict = "late"
    note = "Copied, but the destination could not be read back — size and mtime only, which is not proof."
  } else if (verdict === "overdue") {
    note = "Over a week since the money files were mirrored. Run /save-vault."
  } else if (verdict === "late") {
    note = "A few days since the last mirror."
  }

  return {
    id: "portfolio-mirror",
    name: "Portfolio Performance → MacBook SSD",
    protects: "The encrypted Portfolio Performance files",
    destination: "/Users/matthijs/Documents/Portfolio Performance",
    offsite: false,
    schedule: "Manual — step 1 of /save-vault",
    lastRunMs,
    ageHours: age,
    verdict,
    detail: status?.mirrorStatus ?? null,
    note,
    noteTone: "warn",
  }
}

// ---------------------------------------------------------------------------

const SEVERITY: Record<BackupVerdict, number> = {
  ok: 0,
  unknown: 1,
  late: 2,
  overdue: 3,
  failed: 4,
}

export async function getBackups(): Promise<BackupsSnapshot> {
  const status = await readVaultStatus()

  // allSettled, matching app/api/live/route.ts: one unreadable log must not
  // blank out the other four legs.
  const settled = await Promise.allSettled([
    protonToHdd(),
    vanHollandToProton(),
    timeMachine(),
  ])

  const legs: BackupLeg[] = settled
    .filter((r): r is PromiseFulfilledResult<BackupLeg> => r.status === "fulfilled")
    .map((r) => r.value)

  legs.push(vaultToGithub(status), portfolioMirror(status))

  const worst = legs.reduce<BackupVerdict>(
    (acc, leg) => (SEVERITY[leg.verdict] > SEVERITY[acc] ? leg.verdict : acc),
    "ok",
  )

  return {
    legs,
    worst,
    checkedMs: Date.now(),
    // Hardcoded by hand — not measurable from here, and defaulting it to "recently"
    // would be the dashboard telling a comfortable lie. Set on 2026-08-14, when a
    // restore was performed end-to-end for the first time: restore-test.txt was
    // deleted from the Mac and from Proton, recovered from the HDD, then corrupted
    // and recovered again out of Backup Proton Versions/2026-08-14/. Both paths
    // verified by md5 (f70754fd355e496711a9772969b08ee0), not by eye.
    // Update this date the next time a restore is actually proven, not before.
    restoreTestedMs: Date.parse("2026-08-14T05:42:00Z"),
  }
}
