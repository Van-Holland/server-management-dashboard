import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import type { HealthWarning } from "@/lib/health"
import { isBlip, isEcho, kindOf, type WarningKind } from "@/lib/health-kinds"

/**
 * The Health history (added 2026-10-22).
 *
 * The Health card and page only show what is wrong RIGHT NOW, so a problem that fixed itself left no trace: the nightly internet
 * drop was only found by reading logs. A job on the server calls `POST /api/health/record` every 5 minutes; this module compares the
 * warnings of that moment with the ones it already knows and writes down only the CHANGES: a warning appeared, a warning is gone.
 *
 * Two small files in a folder that survives rebuilds (`/home/matt/health-history`, mounted as `/health-history`):
 *   open.json      what is wrong now and since when, and the time the recording started
 *   history.jsonl  one line per finished event, kept 90 days
 *
 * A warning must be missing from two recordings in a row (about 10 minutes) before it counts as gone, so one failed probe does not
 * split a single problem into two events. The end time is the last moment it was seen.
 */

const DIR = process.env.HEALTH_HISTORY_DIR ?? "/health-history"
const OPEN_FILE = `${DIR}/open.json`
const HISTORY_FILE = `${DIR}/history.jsonl`

const KEEP_MS = 90 * 86400000
const GONE_AFTER_MISSES = 2
const OFTEN_COUNT = 3
const OFTEN_WINDOW_MS = 7 * 86400000
const RECURRING_WINDOW_MS = 30 * 86400000

export type Level = "alert" | "maintenance"
export type HealthEvent = { id: string; title: string; detail: string; level: Level; startMs: number; endMs: number | null }
/** An event as the page sees it: with its kind, worked out when read so the list in health-kinds.ts can change without touching stored data. */
export type KindedEvent = HealthEvent & { kind: WarningKind; echo: boolean }

type OpenEntry = { title: string; detail: string; level: Level; startMs: number; lastSeenMs: number; missing: number }
type OpenState = { startedMs: number; lastRecordedMs: number; open: Record<string, OpenEntry> }

async function readOpen(): Promise<OpenState | null> {
  try {
    return JSON.parse(await readFile(OPEN_FILE, "utf-8")) as OpenState
  } catch {
    return null
  }
}

async function readClosed(): Promise<HealthEvent[]> {
  try {
    return (await readFile(HISTORY_FILE, "utf-8"))
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as HealthEvent)
  } catch {
    return []
  }
}

async function writeAtomic(path: string, text: string) {
  await writeFile(`${path}.tmp`, text)
  await rename(`${path}.tmp`, path)
}

/** Compares the warnings of this moment with the known ones and writes down what changed. */
export async function recordHealth(current: HealthWarning[], nowMs: number): Promise<{ opened: number; closed: number; open: number }> {
  await mkdir(DIR, { recursive: true })
  const state = (await readOpen()) ?? { startedMs: nowMs, lastRecordedMs: nowMs, open: {} }
  const now = new Map<string, HealthWarning>(current.map((w) => [w.id, w]))
  let opened = 0
  const finished: HealthEvent[] = []

  for (const [id, w] of now) {
    const level: Level = w.level === "maintenance" ? "maintenance" : "alert"
    const known = state.open[id]
    if (known) {
      known.title = w.title
      known.detail = w.detail
      if (level === "alert") known.level = "alert"
      known.lastSeenMs = nowMs
      known.missing = 0
    } else {
      state.open[id] = { title: w.title, detail: w.detail, level, startMs: nowMs, lastSeenMs: nowMs, missing: 0 }
      opened++
    }
  }
  for (const [id, e] of Object.entries(state.open)) {
    if (now.has(id)) continue
    e.missing += 1
    if (e.missing >= GONE_AFTER_MISSES) {
      finished.push({ id, title: e.title, detail: e.detail, level: e.level, startMs: e.startMs, endMs: e.lastSeenMs })
      delete state.open[id]
    }
  }
  state.lastRecordedMs = nowMs

  const old = await readClosed()
  const kept = old.filter((e) => nowMs - (e.endMs ?? nowMs) < KEEP_MS)
  if (finished.length > 0 || kept.length !== old.length) {
    await writeAtomic(HISTORY_FILE, [...kept, ...finished].map((e) => JSON.stringify(e)).join("\n") + (kept.length + finished.length > 0 ? "\n" : ""))
  }
  await writeAtomic(OPEN_FILE, JSON.stringify(state))
  return { opened, closed: finished.length, open: Object.keys(state.open).length }
}

// ---------- reading, for the Health page ----------

export type RecurringRow = { kind: WarningKind; id: string; title: string; level: Level; count: number; totalMs: number; lastMs: number; often: boolean; active: boolean }
export type HealthHistory = {
  recordingSinceMs: number | null
  lastRecordedMs: number | null
  /** newest first; events still going have endMs null */
  timeline: KindedEvent[]
  recurring: RecurringRow[]
}

export async function getHealthHistory(nowMs: number): Promise<HealthHistory> {
  const [state, closed] = await Promise.all([readOpen(), readClosed()])
  const openEvents: HealthEvent[] = state ? Object.entries(state.open).map(([id, e]) => ({ id, title: e.title, detail: e.detail, level: e.level, startMs: e.startMs, endMs: null })) : []
  const all: KindedEvent[] = [...closed.filter((e) => !isBlip(e.id, e.startMs, e.endMs)), ...openEvents].sort((a, b) => b.startMs - a.startMs).map((e) => ({ ...e, kind: kindOf(e.id), echo: isEcho(e.id) }))

  const groups = new Map<string, KindedEvent[]>()
  for (const e of all) {
    if (nowMs - (e.endMs ?? nowMs) > RECURRING_WINDOW_MS) continue
    groups.set(e.id, [...(groups.get(e.id) ?? []), e])
  }
  const recurring: RecurringRow[] = [...groups.entries()]
    .map(([id, ev]) => ({
      id,
      kind: kindOf(id),
      title: ev[0].title,
      level: ev.some((e) => e.level === "alert") ? ("alert" as Level) : ("maintenance" as Level),
      count: ev.length,
      totalMs: ev.reduce((sum, e) => sum + ((e.endMs ?? nowMs) - e.startMs), 0),
      lastMs: Math.max(...ev.map((e) => e.endMs ?? nowMs)),
      often: ev.filter((e) => nowMs - e.startMs < OFTEN_WINDOW_MS).length >= OFTEN_COUNT,
      active: ev.some((e) => e.endMs === null),
    }))
    .sort((a, b) => Number(b.often) - Number(a.often) || b.count - a.count || b.lastMs - a.lastMs)

  return { recordingSinceMs: state?.startedMs ?? null, lastRecordedMs: state?.lastRecordedMs ?? null, timeline: all, recurring }
}
