import { HEATING, SCHEDULE_POINTS, SCHEDULE_START_TARGET, TEMP_MAX, TEMP_MIN } from "@/lib/huis-config"
import { callService, getHistory, getStates, haConfigured, totalAt, type HaState } from "@/lib/ha"
import { activePeriod, readTariffs } from "@/lib/tariffs"
import {
  AWAY_MODES,
  type AwayMode,
  type CostBreakdown,
  type CostState,
  type DayPoint,
  type EnergyState,
  type HeatingState,
  type HuisSnapshot,
} from "@/lib/huis-types"

/**
 * Builds the picture the Heating and energy page shows, from Home Assistant (added 2026-11-21).
 *
 * Heating works today. The gas and electricity part waits for the P1 reader (a Wi-Fi dongle in the smart meter's P1 port): until Home
 * Assistant has those sensors the page says "waiting for the P1 reader". The sensors are found by what they measure (power in W, energy
 * in kWh, gas in m³); if the guess is wrong, set HUIS_POWER_ENTITY, HUIS_ENERGY_ENTITY and HUIS_GAS_ENTITY in .env.
 * HUIS_DEMO=1 shows made-up data, for trying the page on a computer that cannot reach Home Assistant.
 */

export const demoMode = () => process.env.HUIS_DEMO === "1"

// ---------- small time helpers (the server runs in Europe/Amsterdam) ----------

const pad = (n: number) => String(n).padStart(2, "0")
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes()
const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** The target the Remeha program asks for at a minute of the day. */
export function scheduledTarget(min: number): number {
  let target = SCHEDULE_START_TARGET
  for (const point of SCHEDULE_POINTS) if (min >= point.at) target = point.target
  return target
}

// ---------- heating ----------

function parseHeating(states: HaState[]): HeatingState | null {
  const climate = states.find((s) => s.entity_id === HEATING.climate)
  if (!climate) return null
  const a = climate.attributes
  const mode = states.find((s) => s.entity_id === HEATING.awayMode)?.state
  const until = states.find((s) => s.entity_id === HEATING.awayUntil)?.state
  const action = a.hvac_action
  return {
    roomTemp: num(a.current_temperature),
    target: num(a.temperature),
    hvacMode: climate.state === "auto" || climate.state === "heat" || climate.state === "off" ? climate.state : "unknown",
    preset: typeof a.preset_mode === "string" ? a.preset_mode : null,
    action: action === "heating" || action === "idle" || action === "off" ? action : "unknown",
    awayMode: AWAY_MODES.find((m) => m === mode) ?? null,
    awayUntil: typeof until === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(until) ? until : null,
  }
}

async function buildDay(now: Date): Promise<DayPoint[]> {
  const midnight = startOfDay(now)
  const rows = (await getHistory([HEATING.climate], midnight, now, true))[HEATING.climate] ?? []
  const points: DayPoint[] = []
  for (const row of rows) {
    const at = new Date(row.last_updated ?? row.last_changed)
    // The first row is the state at midnight; its own timestamp can be from yesterday.
    points.push({ min: at < midnight ? 0 : minuteOfDay(at), room: num(row.attributes?.current_temperature), target: num(row.attributes?.temperature) })
  }
  return points
}

// ---------- gas and electricity ----------

type MeterIds = { power?: string; energy?: string; gas?: string }

function discover(states: HaState[]): MeterIds {
  const known = (id?: string) => (id && states.some((s) => s.entity_id === id) ? id : undefined)
  // Remeha's own energy sensors (sensor.home_...) are about the boiler, not the meter.
  const sensors = states.filter((s) => s.entity_id.startsWith("sensor.") && !s.entity_id.startsWith("sensor.home_"))
  const find = (test: (s: HaState) => boolean) => (sensors.find((s) => /p1/i.test(s.entity_id) && test(s)) ?? sensors.find(test))?.entity_id
  const unit = (s: HaState) => s.attributes.unit_of_measurement
  const cls = (s: HaState) => s.attributes.device_class
  return {
    power: known(process.env.HUIS_POWER_ENTITY) ?? find((s) => cls(s) === "power" && unit(s) === "W" && !/l[123]|phase/i.test(s.entity_id)),
    energy:
      known(process.env.HUIS_ENERGY_ENTITY) ??
      find((s) => cls(s) === "energy" && unit(s) === "kWh" && /import|consum|total/i.test(s.entity_id) && !/t[12]|export|return/i.test(s.entity_id)),
    gas: known(process.env.HUIS_GAS_ENTITY) ?? find((s) => cls(s) === "gas"),
  }
}

type Row = { state: string; last_changed: string }

/** The last numeric value at or before a moment, from a list of history rows. */
function valueAt(rows: Row[], when: Date): number | null {
  let value: number | null = null
  for (const row of rows) {
    if (new Date(row.last_changed).getTime() > when.getTime()) break
    const n = num(row.state)
    if (n !== null) value = n
  }
  return value
}

async function buildEnergy(states: HaState[], now: Date): Promise<{ energy: EnergyState; ids: MeterIds; kwhNow: number | null; m3Now: number | null }> {
  const ids = discover(states)
  const missing = [!ids.power && "power", !ids.energy && "electricity", !ids.gas && "gas"].filter(Boolean) as string[]
  const stateOf = (id?: string) => (id ? num(states.find((s) => s.entity_id === id)?.state) : null)
  const midnight = startOfDay(now)

  const kwhNow = stateOf(ids.energy)
  const m3Now = stateOf(ids.gas)
  const kwhMidnight = ids.energy ? await totalAt(ids.energy, midnight) : null
  const m3Midnight = ids.gas ? await totalAt(ids.gas, midnight) : null
  const diff = (a: number | null, b: number | null) => (a !== null && b !== null && a >= b ? round(a - b, 3) : null)

  // Power over the last 6 hours, averaged into 6-minute buckets.
  const powerSeries: { min: number; w: number }[] = []
  if (ids.power) {
    const from = new Date(now.getTime() - 6 * 3600_000)
    const rows = (await getHistory([ids.power], from, now))[ids.power] ?? []
    const buckets = new Map<number, number[]>()
    for (const row of rows) {
      const w = num(row.state)
      if (w === null) continue
      const ago = Math.floor((now.getTime() - new Date(row.last_changed).getTime()) / 360_000)
      if (ago < 0 || ago > 59) continue
      buckets.set(ago, [...(buckets.get(ago) ?? []), w])
    }
    for (const [ago, list] of [...buckets.entries()].sort((a, b) => b[0] - a[0])) powerSeries.push({ min: ago * 6, w: Math.round(list.reduce((s, v) => s + v, 0) / list.length) })
  }

  // Gas per hour today: the total at the end of each hour minus the total at its start.
  const gasHours: { hour: number; m3: number }[] = []
  if (ids.gas) {
    const rows = (await getHistory([ids.gas], midnight, now))[ids.gas] ?? []
    for (let hour = 0; hour <= now.getHours(); hour++) {
      const start = new Date(midnight.getTime() + hour * 3600_000)
      const end = new Date(Math.min(start.getTime() + 3600_000, now.getTime()))
      const a = valueAt(rows, start)
      const b = valueAt(rows, end)
      gasHours.push({ hour, m3: a !== null && b !== null && b >= a ? round(b - a, 3) : 0 })
    }
  }

  return {
    energy: { powerW: stateOf(ids.power), powerSeries, todayKwh: diff(kwhNow, kwhMidnight), todayM3: diff(m3Now, m3Midnight), gasHours, missing },
    ids,
    kwhNow,
    m3Now,
  }
}

// ---------- costs ----------

function breakdown(kwh: number, m3: number, days: number, perKwh: number, perM3: number, fixedPerMonth: number, month: Date): CostBreakdown {
  const electricity = kwh * perKwh
  const gas = m3 * perM3
  const fixed = (fixedPerMonth / daysInMonth(month)) * days
  return { electricity: round(electricity), gas: round(gas), fixed: round(fixed), total: round(electricity + gas + fixed), kwh: round(kwh, 1), m3: round(m3, 1), days }
}

async function buildCosts(now: Date, energy: EnergyState | null, ids: MeterIds, kwhNow: number | null, m3Now: number | null): Promise<CostState> {
  const tariffs = await readTariffs()
  if (tariffs.length === 0) return { state: "no-tariff" }
  const today = localDay(now)
  const period = activePeriod(tariffs, today)
  if (!period) return { state: "not-started", startsOn: tariffs[0].from }
  if (!energy || energy.missing.includes("electricity") || energy.missing.includes("gas") || energy.todayKwh === null || energy.todayM3 === null) return { state: "no-data" }

  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
  const since = period.from > monthStart ? period.from : monthStart
  const sinceDate = new Date(`${since}T00:00:00`)
  const kwhThen = ids.energy ? await totalAt(ids.energy, sinceDate) : null
  const m3Then = ids.gas ? await totalAt(ids.gas, sinceDate) : null
  const haveMonth = kwhNow !== null && m3Now !== null && kwhThen !== null && m3Then !== null
  const days = Math.round((startOfDay(now).getTime() - sinceDate.getTime()) / 86_400_000) + 1

  // A price change in the middle of a month is not split: the month uses the prices that count today.
  const todayCost = breakdown(energy.todayKwh, energy.todayM3, 1, period.electricityPerKwh, period.gasPerM3, period.fixedPerMonth, now)
  const monthCost = haveMonth
    ? breakdown(Math.max(0, kwhNow - kwhThen), Math.max(0, m3Now - m3Then), days, period.electricityPerKwh, period.gasPerM3, period.fixedPerMonth, now)
    : todayCost
  return { state: "ok", today: todayCost, month: monthCost, since: haveMonth ? since : today }
}

// ---------- demo data ----------

type DemoState = { target: number | null; hvac: "auto" | "heat" | "off"; away: AwayMode; until: string | null }
const g = globalThis as unknown as { __huisDemo?: DemoState }
function demoState(): DemoState {
  return (g.__huisDemo ??= { target: null, hvac: "auto", away: "Thuis", until: null })
}

async function demoSnapshot(now: Date): Promise<HuisSnapshot> {
  const demo = demoState()
  const nowMin = minuteOfDay(now)
  // A simple room that warms 0.35 degrees per 10 minutes towards the target and cools 0.05 when it is above it.
  const points: DayPoint[] = []
  let room = 16.2
  for (let min = 0; min <= nowMin; min += 10) {
    const target = demo.hvac === "off" ? 5 : demo.hvac === "heat" ? (demo.target ?? 16) : scheduledTarget(min)
    room += room < target - 0.15 ? 0.35 : -0.05
    points.push({ min, room: round(room, 1), target: demo.hvac === "off" ? null : target })
  }
  const target = demo.hvac === "off" ? null : demo.target ?? scheduledTarget(nowMin)
  const heating: HeatingState = {
    roomTemp: round(room, 1),
    target,
    hvacMode: demo.hvac,
    preset: demo.hvac === "off" ? "anti_frost" : demo.hvac === "heat" ? "manual" : "clock_program_1",
    action: target === null ? "off" : room < target - 0.15 ? "heating" : "idle",
    awayMode: demo.away,
    awayUntil: demo.until,
  }
  const hour = now.getHours()
  const gasHours = Array.from({ length: hour + 1 }, (_, h) => ({ hour: h, m3: round(h >= 5 && h < 17 ? 0.25 + 0.2 * Math.abs(Math.sin(h)) : 0.04, 2) }))
  const powerSeries = Array.from({ length: 60 }, (_, i) => ({ min: (59 - i) * 6, w: Math.round(260 + 220 * Math.abs(Math.sin(i / 5)) + (i % 7 === 0 ? 700 : 0)) }))
  const energy: EnergyState = {
    powerW: 412,
    powerSeries,
    todayKwh: round(0.28 * (hour + 1), 1),
    todayM3: round(gasHours.reduce((s, h) => s + h.m3, 0), 1),
    gasHours,
    missing: [],
  }
  const tariffs = await readTariffs()
  let costs: CostState = { state: "no-tariff" }
  const period = activePeriod(tariffs, localDay(now))
  if (tariffs.length > 0 && !period) costs = { state: "not-started", startsOn: tariffs[0].from }
  if (period) {
    const day = (days: number, kwh: number, m3: number) => breakdown(kwh, m3, days, period.electricityPerKwh, period.gasPerM3, period.fixedPerMonth, now)
    costs = { state: "ok", today: day(1, energy.todayKwh!, energy.todayM3!), month: day(Math.max(1, now.getDate()), 6.2 * now.getDate(), 3.4 * now.getDate()), since: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01` }
  }
  return { source: "demo", nowIso: now.toISOString(), heating, day: { points, nowMin }, energy, costs }
}

// ---------- the page's data ----------

export async function getHuisSnapshot(): Promise<HuisSnapshot> {
  const now = new Date()
  if (demoMode()) return demoSnapshot(now)
  const empty = { points: [], nowMin: minuteOfDay(now) }
  if (!haConfigured()) {
    return { source: "unconfigured", message: "Home Assistant is not connected yet: HA_URL and HA_TOKEN are missing from the server's .env.", nowIso: now.toISOString(), heating: null, day: empty, energy: null, costs: { state: "no-tariff" } }
  }
  try {
    const states = await getStates()
    const heating = parseHeating(states)
    // The day line and the energy numbers ask Home Assistant different questions, so they run side by side.
    const [points, built] = await Promise.all([buildDay(now).catch(() => [] as DayPoint[]), buildEnergy(states, now)])
    const costs = await buildCosts(now, built.energy, built.ids, built.kwhNow, built.m3Now)
    return { source: "live", nowIso: now.toISOString(), heating, day: { points, nowMin: minuteOfDay(now) }, energy: built.energy, costs }
  } catch (error) {
    return { source: "error", message: error instanceof Error ? error.message : "Home Assistant could not be reached.", nowIso: now.toISOString(), heating: null, day: empty, energy: null, costs: { state: "no-tariff" } }
  }
}

// ---------- controls ----------

/** Checks what the browser sent for the away mode. `until` is a "datetime-local" value: "YYYY-MM-DDTHH:mm", local time. */
export function validateAway(mode: unknown, until: unknown, now = new Date()): { ok: true; mode: AwayMode; until: string | null } | { ok: false; error: string } {
  const chosen = AWAY_MODES.find((m) => m === mode)
  if (!chosen) return { ok: false, error: "Unknown mode." }
  if (chosen === "Thuis") return { ok: true, mode: chosen, until: null }
  if (typeof until !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(until)) return { ok: false, error: "Choose when you are back." }
  const back = new Date(until)
  if (Number.isNaN(back.getTime())) return { ok: false, error: "That date is not valid." }
  const hours = (back.getTime() - now.getTime()) / 3600_000
  if (hours <= 0.1) return { ok: false, error: "The return time must be in the future." }
  if (chosen === "Lang weg" && hours <= 24.1) return { ok: false, error: "Long away needs a return time more than 24 hours ahead. Use short away instead." }
  if (hours > 24 * 60) return { ok: false, error: "That is more than 60 days away." }
  return { ok: true, mode: chosen, until: `${until.replace("T", " ")}:00` }
}

export async function setAway(mode: AwayMode, until: string | null): Promise<void> {
  if (demoMode()) {
    const d = demoState()
    d.away = mode
    d.until = until
    d.hvac = mode === "Thuis" ? "auto" : mode === "Kort weg" ? "heat" : "off"
    d.target = mode === "Kort weg" ? 16 : null
    return
  }
  // The return time goes in first: the automation reads it the moment the mode changes.
  if (until) await callService("input_datetime", "set_datetime", { entity_id: HEATING.awayUntil, datetime: until })
  await callService("input_select", "select_option", { entity_id: HEATING.awayMode, option: mode })
}

export function validateTemperature(value: unknown): { ok: true; temperature: number } | { ok: false; error: string } {
  const t = typeof value === "number" ? value : NaN
  if (!Number.isFinite(t) || t < TEMP_MIN || t > TEMP_MAX) return { ok: false, error: `Choose a temperature between ${TEMP_MIN} and ${TEMP_MAX}.` }
  return { ok: true, temperature: Math.round(t * 2) / 2 }
}

export async function setTemperature(temperature: number): Promise<void> {
  if (demoMode()) {
    demoState().target = temperature
    return
  }
  await callService("climate", "set_temperature", { entity_id: HEATING.climate, temperature })
}
