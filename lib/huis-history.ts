import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { HEATING } from "@/lib/huis-config"
import { getHistory } from "@/lib/ha"
import { DEGREE_DAY_BASE, type DayDetail, type DayPoint, type DayStat, type Span } from "@/lib/huis-types"

/**
 * Turns Home Assistant's history into the numbers the Today, Week and Night test tabs show (added 2026-11-21).
 *
 * The boiler is "on" when the thermostat reports hvac_action = heating. Outside temperature comes from a weather entity
 * (Met.no, `weather.thuis`; HUIS_WEATHER_ENTITY overrides). Gas (m3) is used as soon as the P1 reader provides it.
 * Home Assistant keeps only about 10 days of history, so every finished day is also written to days.json in the data folder.
 *
 * Score = boiler hours (or gas m3) divided by degree-days. A degree-day is 18 minus the average outside temperature: a cold day
 * burns more gas whatever you do, and dividing by the cold takes that out, so two days (or two night temperatures) compare fairly.
 */

export const weatherEntity = () => process.env.HUIS_WEATHER_ENTITY ?? "weather.thuis"

const HOUR = 3600_000
const DAY = 24 * HOUR

type Row = { t: number; action: string | null; room: number | null; target: number | null }
type Sample = { t: number; v: number }
type MinimalRow = { state: string; last_changed: string }

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const pad = (n: number) => String(n).padStart(2, "0")
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

// ---------- turning raw history into rows ----------

type RawRow = { state: string; attributes?: Record<string, unknown>; last_changed: string; last_updated?: string }

export function climateRows(raw: RawRow[], from: number): Row[] {
  const rows: Row[] = raw.map((r) => ({
    // The first row is the state at the start of the window; its own timestamp can be older.
    t: Math.max(from, new Date(r.last_updated ?? r.last_changed).getTime()),
    action: typeof r.attributes?.hvac_action === "string" ? r.attributes.hvac_action : null,
    room: num(r.attributes?.current_temperature),
    target: num(r.attributes?.temperature),
  }))
  return rows.sort((a, b) => a.t - b.t)
}

export function weatherSamples(raw: RawRow[], from: number): Sample[] {
  const out: Sample[] = []
  for (const r of raw) {
    const v = num(r.attributes?.temperature)
    if (v !== null) out.push({ t: Math.max(from, new Date(r.last_updated ?? r.last_changed).getTime()), v })
  }
  return out.sort((a, b) => a.t - b.t)
}

// ---------- measuring over a window ----------

/** Milliseconds the boiler was heating between two moments. */
export function boilerMs(rows: Row[], a: number, b: number): number {
  let total = 0
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].action !== "heating") continue
    const start = Math.max(rows[i].t, a)
    const end = Math.min(rows[i + 1]?.t ?? b, b)
    if (end > start) total += end - start
  }
  return total
}

export function boilerSpans(rows: Row[], dayStart: number, dayEnd: number): Span[] {
  const spans: Span[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].action !== "heating") continue
    const start = Math.max(rows[i].t, dayStart)
    const end = Math.min(rows[i + 1]?.t ?? dayEnd, dayEnd)
    if (end <= start) continue
    const span = { from: Math.round((start - dayStart) / 60_000), to: Math.round((end - dayStart) / 60_000) }
    const last = spans[spans.length - 1]
    if (last && span.from - last.to <= 1) last.to = span.to
    else spans.push(span)
  }
  return spans
}

/** Time-weighted average of a step signal between two moments. Null when there is no reading at all in the window. */
export function average(samples: Sample[], a: number, b: number): number | null {
  if (b <= a) return null
  let sum = 0
  let covered = 0
  for (let i = 0; i < samples.length; i++) {
    const start = Math.max(samples[i].t, a)
    const end = Math.min(samples[i + 1]?.t ?? b, b)
    if (end > start) {
      sum += samples[i].v * (end - start)
      covered += end - start
    }
  }
  return covered > 0 ? sum / covered : null
}

function commonTarget(rows: Row[], a: number, b: number): number | null {
  const time = new Map<number, number>()
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].target === null) continue
    const start = Math.max(rows[i].t, a)
    const end = Math.min(rows[i + 1]?.t ?? b, b)
    if (end > start) time.set(rows[i].target as number, (time.get(rows[i].target as number) ?? 0) + (end - start))
  }
  let best: number | null = null
  let most = 0
  for (const [target, ms] of time) if (ms > most) [best, most] = [target, ms]
  return best
}

/**
 * The morning warm-up. It starts when the boiler begins its run in the early morning (the thermostat starts early on its own, before
 * the program's switch) and ends when the room first gets within 0.3 degrees of the day's target. The overshoot is how far the room
 * climbs above the target afterwards (a floor keeps heating after the boiler stops). `a` is midnight of the day.
 */
export function warmup(rows: Row[], a: number): { minutes: number; target: number; fromMin: number; overshoot: number } | null {
  const from = a + 1 * HOUR
  const to = a + 12 * HOUR
  const targets = rows.filter((r) => r.t >= a + 4 * HOUR && r.t <= to && r.target !== null).map((r) => r.target as number)
  if (targets.length === 0) return null
  const target = Math.max(...targets)
  if (target < 18) return null
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (row.t < from || row.t > to || row.action !== "heating" || rows[i - 1].action === "heating") continue
    const startRoom = row.room ?? rows[i - 1].room
    // A real warm-up starts at least a degree below the target.
    if (startRoom === null || startRoom > target - 1) continue
    for (let j = i; j < rows.length; j++) {
      if (rows[j].t > a + 14 * HOUR) return null
      if (rows[j].room !== null && (rows[j].room as number) >= target - 0.3) {
        let peak = rows[j].room as number
        for (let k = j; k < rows.length && rows[k].t <= rows[j].t + 3 * HOUR; k++) if (rows[k].room !== null && (rows[k].room as number) > peak) peak = rows[k].room as number
        return { minutes: Math.round((rows[j].t - row.t) / 60_000), target, fromMin: Math.round((row.t - a) / 60_000), overshoot: Math.max(0, round(peak - target, 1)) }
      }
    }
    return null
  }
  return null
}

function gasBetween(rows: MinimalRow[], a: number, b: number): number | null {
  const at = (when: number) => {
    let value: number | null = null
    for (const r of rows) {
      if (new Date(r.last_changed).getTime() > when) break
      const n = num(r.state)
      if (n !== null) value = n
    }
    return value
  }
  const x = at(a)
  const y = at(b)
  return x !== null && y !== null && y >= x ? round(y - x, 3) : null
}

function score(value: number | null, dd: number | null, minDd: number): number | null {
  return value !== null && dd !== null && dd >= minDd ? round(value / dd, 3) : null
}

// ---------- one day ----------

export function buildDayStat(rows: Row[], weather: Sample[], gas: MinimalRow[] | null, day: Date, now: number): DayStat {
  const a = day.getTime()
  const fullEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  const end = Math.min(fullEnd, now)
  const hourMin = Array.from({ length: 24 }, (_, h) => {
    const s = a + h * HOUR
    return Math.round(boilerMs(rows, s, Math.min(s + HOUR, end)) / 60_000)
  })
  const outsideAvg = average(weather, a, end)
  const dd = outsideAvg === null ? null : Math.max(0, DEGREE_DAY_BASE - outsideAvg)
  const gasM3 = gas ? gasBetween(gas, a, end) : null
  const boilerMin = hourMin.reduce((s, m) => s + m, 0)

  // The night cycle that ended this evening: from 22:00 yesterday to 22:00 today. A floor keeps its heat for hours, so a cold night
  // saves gas at night but costs it back at the morning warm-up; counting the whole cycle puts both in one number. Only when it is over.
  const cycleFrom = a - 2 * HOUR
  const cycleTo = a + 22 * HOUR
  let night: DayStat["night"] = null
  if (cycleTo <= now) {
    const cOut = average(weather, cycleFrom, cycleTo)
    const cDd = cOut === null ? null : Math.max(0, DEGREE_DAY_BASE - cOut)
    const cBoiler = Math.round(boilerMs(rows, cycleFrom, cycleTo) / 60_000)
    const cGas = gas ? gasBetween(gas, cycleFrom, cycleTo) : null
    night = {
      // The setting that held during the quiet middle of the night (23:00 to 05:00).
      target: commonTarget(rows, a - HOUR, a + 5 * HOUR),
      boilerMin: cBoiler,
      outsideAvg: cOut === null ? null : round(cOut, 1),
      degreeDays: cDd === null ? null : round(cDd, 2),
      gasM3: cGas,
      scoreHours: score(cBoiler / 60, cDd, 1),
      scoreGas: score(cGas, cDd, 1),
    }
  }

  const w = warmup(rows, a)
  return {
    date: dayKey(day),
    partial: end < fullEnd,
    boilerMin,
    hourMin,
    outsideAvg: outsideAvg === null ? null : round(outsideAvg, 1),
    degreeDays: dd === null ? null : round(dd, 1),
    gasM3,
    scoreHours: score(boilerMin / 60, dd, 1),
    scoreGas: score(gasM3, dd, 1),
    night,
    warmupMin: w?.minutes ?? null,
    warmupTarget: w?.target ?? null,
    warmupFromMin: w?.fromMin ?? null,
    overshoot: w?.overshoot ?? null,
  }
}

/** One day as the Today chart wants it. */
export function buildDetail(rows: Row[], weather: Sample[], day: Date, now: number): DayDetail {
  const a = day.getTime()
  const fullEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  const end = Math.min(fullEnd, now)
  const inDay = rows.filter((r) => r.t >= a && r.t <= end)
  const points: DayPoint[] = inDay.map((r) => ({ min: Math.round((r.t - a) / 60_000), room: r.room, target: r.target }))
  const outside: { min: number; t: number }[] = []
  for (const s of weather) if (s.t >= a && s.t <= end) outside.push({ min: Math.round((s.t - a) / 60_000), t: round(s.v, 1) })
  // A reading from before midnight still holds at midnight.
  const before = [...weather].reverse().find((s) => s.t < a)
  if (before) outside.unshift({ min: 0, t: round(before.v, 1) })
  return { points, boiler: boilerSpans(rows, a, end), outside, nowMin: Math.round((end - a) / 60_000) }
}

// ---------- the stored days ----------

const dir = () => process.env.HUIS_DATA_DIR ?? (process.env.NODE_ENV === "production" ? "/huis-data" : path.join(process.cwd(), ".huis-data"))
const file = () => path.join(dir(), "days.json")

async function readStored(): Promise<DayStat[]> {
  try {
    const parsed = JSON.parse(await readFile(file(), "utf8"))
    return Array.isArray(parsed?.days) ? (parsed.days as DayStat[]) : []
  } catch {
    return []
  }
}

async function writeStored(days: DayStat[]): Promise<void> {
  try {
    await mkdir(dir(), { recursive: true })
    const tmp = `${file()}.tmp`
    await writeFile(tmp, JSON.stringify({ days }, null, 1))
    await rename(tmp, file())
  } catch {
    // Not being able to save is not worth breaking the page for.
  }
}

/** Finished days from the file, topped up and corrected with what Home Assistant knows now. Newest day last. */
export function mergeDays(stored: DayStat[], fresh: DayStat[]): DayStat[] {
  const byDate = new Map<string, DayStat>()
  for (const d of stored) byDate.set(d.date, d)
  for (const d of fresh) {
    const old = byDate.get(d.date)
    // Keep a stored night when Home Assistant no longer has the data to rebuild it.
    byDate.set(d.date, { ...d, night: d.night ?? old?.night ?? null })
  }
  return [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date)).slice(-120)
}

export type HistoryResult = { today: DayDetail; yesterday: DayDetail; days: DayStat[]; outsideNow: number | null }

/** Reads about nine days of history and builds everything the tabs need. Gas history is skipped while there is no gas sensor. */
export async function loadHistory(now: Date, gasEntity?: string): Promise<HistoryResult> {
  const today = midnight(now)
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 9)
  const weatherId = weatherEntity()
  const [climate, weatherRaw, gasRaw] = await Promise.all([
    getHistory([HEATING.climate], from, now, true),
    getHistory([weatherId], from, now, true).catch(() => ({}) as Record<string, RawRow[]>),
    gasEntity ? getHistory([gasEntity], from, now).catch(() => ({}) as Record<string, MinimalRow[]>) : Promise.resolve({} as Record<string, MinimalRow[]>),
  ])
  const rawClimate = (climate[HEATING.climate] ?? []) as RawRow[]
  const rows = climateRows(rawClimate, from.getTime())
  // When Home Assistant first recorded the thermostat. Days before that have no data, and the day it started is incomplete.
  const first = rawClimate[0]
  const coverage = first ? new Date(first.last_updated ?? first.last_changed).getTime() : Number.POSITIVE_INFINITY
  const weather = weatherSamples((weatherRaw[weatherId] ?? []) as RawRow[], from.getTime())
  const gas = gasEntity ? ((gasRaw[gasEntity] ?? []) as MinimalRow[]) : null

  const t = now.getTime()
  const fresh: DayStat[] = []
  for (let back = 8; back >= 0; back--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back)
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
    if (dayEnd <= coverage) continue
    const stat = buildDayStat(rows, weather, gas, day, t)
    // The day (and the night before it) the recording began in is incomplete: show it, never store or score it.
    if (day.getTime() < coverage - 15 * 60_000) {
      stat.partial = true
      stat.scoreHours = null
      stat.scoreGas = null
      stat.warmupMin = null
      stat.warmupTarget = null
      stat.warmupFromMin = null
      stat.overshoot = null
    }
    if (day.getTime() - 2 * HOUR < coverage) stat.night = null
    fresh.push(stat)
  }
  const stored = await readStored()
  const days = mergeDays(stored, fresh)
  const finished = days.filter((d) => !d.partial)
  if (JSON.stringify(finished) !== JSON.stringify(stored)) await writeStored(finished)

  const yesterdayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const lastWeather = weather[weather.length - 1]
  return {
    today: buildDetail(rows, weather, today, t),
    yesterday: buildDetail(rows, weather, yesterdayDate, t),
    days,
    outsideNow: lastWeather ? round(lastWeather.v, 1) : null,
  }
}
