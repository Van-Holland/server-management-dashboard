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
}

export type BackupsSnapshot = {
  legs: BackupLeg[]
  worst: BackupVerdict
  checkedMs: number
  /** Set when a restore has never been verified. Deliberately not a leg — it is
   *  a property of the whole system, not of any single job. */
  restoreTested: boolean
}

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

/** Counts real rclone ERROR lines only. A bare /error/i match also hits
 *  filenames and INFO text, which is how a healthy run can look broken. */
function rcloneErrors(log: string): number {
  return [...log.matchAll(/^\d{4}\/\d{2}\/\d{2} [\d:]+ ERROR\s*:/gm)].length
}

async function protonToHdd(): Promise<BackupLeg> {
  const log = await readTail(RCLONE_LOG)
  const lastRunMs = log ? lastRcloneTimestamp(log) : null
  const age = hoursSince(lastRunMs)
  const errors = log ? rcloneErrors(log) : 0

  let verdict = judge(age, 27, 36)
  let note: string | null = null
  if (!log) {
    verdict = "unknown"
    note = "Log file unreadable — the job's status cannot be established either way."
  } else if (verdict === "overdue") {
    note = "Has not run since well past its scheduled window. Check cron and the Proton token."
  } else if (verdict === "late") {
    note = "Later than its 03:00 slot but not yet alarming."
  } else if (errors > 0) {
    note = `Ran, but the log tail contains ${errors} ERROR line${errors === 1 ? "" : "s"}.`
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
    return JSON.parse(await readFile(`${STATUS_DIR}/vault.json`, "utf-8")) as VaultStatus
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
    // Hardcoded false until a restore is actually performed and this is flipped
    // by hand. It is not measurable from here, and defaulting it to true would
    // be the dashboard telling a comfortable lie.
    restoreTested: false,
  }
}
