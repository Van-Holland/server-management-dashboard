import { HEATING, SCHEDULE_POINTS, SCHEDULE_START_TARGET, TEMP_MAX, TEMP_MIN } from "@/lib/huis-config"
import { callService, getHistory, getStates, haConfigured, totalAt, type HaState } from "@/lib/ha"
import { dayKey } from "@/lib/huis-history"
import { loadHistory } from "@/lib/huis-history"
import { applyPlan, emptyPlan, parsePlan, type PlanChange } from "@/lib/huis-plan"
import { activePeriod, readTariffs } from "@/lib/tariffs"
import {
  AWAY_MODES,
  type AwayMode,
  type CostBreakdown,
  type CostState,
  type DayDetail,
  type DayPoint,
  type DayStat,
  type EnergyState,
  type HeatingState,
  type HuisSnapshot,
  type PlanState,
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

type DemoState = { target: number | null; hvac: "auto" | "heat" | "off"; away: AwayMode; until: string | null; plan: PlanState }
const g = globalThis as unknown as { __huisDemo?: DemoState }
function demoState(): DemoState {
  return (g.__huisDemo ??= {
    target: null,
    hvac: "auto",
    away: "Thuis",
    until: null,
    plan: { ...emptyPlan, available: true, dayTemp: 21, nightTemp: 16, dayStart: "06:00", eveningStart: "17:00", nightStart: "22:00", testOn: true, testSeries: [12, 14, 16, 18], testStep: 5 },
  })
}

/** Made-up days for trying the page: colder days burn more, a colder night burns less, with a little noise. */
function demoDays(now: Date): { days: DayStat[]; yesterday: DayDetail; today: DayDetail } {
  const nights = [16, 14, 12, 18, 14, 16, 12, 18]
  const days: DayStat[] = []
  for (let back = 8; back >= 0; back--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)
    const avg = round(4 + 3 * Math.sin(back * 1.1) + (8 - back) * 0.2, 1)
    const dd = Math.max(0, 18 - avg)
    const boilerMin = Math.round((dd * 0.31 + 0.4 * Math.sin(back * 2.3)) * 60)
    const hourMin = Array.from({ length: 24 }, (_, h) => (h >= 5 && h < 22 ? Math.round(boilerMin / 17 + 4 * Math.sin(h + back)) : 0)).map((m) => Math.max(0, m))
    const nightTarget = nights[back % nights.length]
    // Made-up bowl: a very cold night saves at night but pays back in the morning, so around 14 to 16 comes out cheapest.
    const cycleMin = Math.round(boilerMin * (1 + 0.012 * (nightTarget - 15) ** 2) + 6 * Math.sin(back * 3.1))
    const partial = back === 0
    days.push({
      date: dayKey(d),
      partial,
      boilerMin: partial ? Math.round(boilerMin * 0.8) : boilerMin,
      hourMin,
      outsideAvg: avg,
      degreeDays: round(dd, 1),
      gasM3: null,
      scoreHours: round(boilerMin / 60 / dd, 3),
      scoreGas: null,
      night: partial ? null : { target: nightTarget, boilerMin: cycleMin, outsideAvg: avg, degreeDays: round(dd, 2), gasM3: null, scoreHours: round(cycleMin / 60 / dd, 3), scoreGas: null },
      warmupMin: 70 + Math.round(15 * Math.sin(back)),
      warmupTarget: 21,
    })
  }
  const nowMin = minuteOfDay(now)
  const detail = (upTo: number, shift: number): DayDetail => {
    const points: DayPoint[] = []
    let room = 16.2 + shift
    const boiler: DayDetail["boiler"] = []
    for (let min = 0; min <= upTo; min += 10) {
      const target = scheduledTarget(min)
      const heating = room < target - 0.15
      room += heating ? 0.35 : -0.05
      if (heating) {
        const last = boiler[boiler.length - 1]
        if (last && min - last.to <= 10) last.to = min + 10
        else boiler.push({ from: min, to: min + 10 })
      }
      points.push({ min, room: round(room, 1), target })
    }
    return { points, boiler, outside: Array.from({ length: Math.floor(upTo / 60) + 1 }, (_, h) => ({ min: h * 60, t: round(3 + 4 * Math.sin(((h - 9) / 24) * 6.28) + 2 + shift, 1) })), nowMin: upTo }
  }
  return { days, today: detail(nowMin, 0), yesterday: detail(1439, 0.3) }
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
  const demoHistory = demoDays(now)
  // The demo day comes from the simple room model above so the target buttons still move the line.
  return {
    source: "demo",
    nowIso: now.toISOString(),
    heating,
    day: { ...demoHistory.today, points, nowMin },
    yesterday: demoHistory.yesterday,
    days: demoHistory.days,
    outsideNow: demoHistory.today.outside[demoHistory.today.outside.length - 1]?.t ?? null,
    plan: demo.plan,
    energy,
    costs,
  }
}

// ---------- the page's data ----------

export async function getHuisSnapshot(): Promise<HuisSnapshot> {
  const now = new Date()
  if (demoMode()) return demoSnapshot(now)
  const empty: DayDetail = { points: [], boiler: [], outside: [], nowMin: minuteOfDay(now) }
  const bare = { yesterday: null, days: [] as DayStat[], outsideNow: null, plan: emptyPlan }
  if (!haConfigured()) {
    return { source: "unconfigured", message: "Home Assistant is not connected yet: HA_URL and HA_TOKEN are missing from the server's .env.", nowIso: now.toISOString(), heating: null, day: empty, ...bare, energy: null, costs: { state: "no-tariff" } }
  }
  try {
    const states = await getStates()
    const heating = parseHeating(states)
    // The history and the energy numbers ask Home Assistant different questions, so they run side by side.
    const built = await buildEnergy(states, now)
    const [history, costs] = await Promise.all([
      loadHistory(now, built.ids.gas).catch(() => null),
      buildCosts(now, built.energy, built.ids, built.kwhNow, built.m3Now),
    ])
    return {
      source: "live",
      nowIso: now.toISOString(),
      heating,
      day: history?.today ?? empty,
      yesterday: history?.yesterday ?? null,
      days: history?.days ?? [],
      outsideNow: history?.outsideNow ?? null,
      plan: parsePlan(states),
      energy: built.energy,
      costs,
    }
  } catch (error) {
    return { source: "error", message: error instanceof Error ? error.message : "Home Assistant could not be reached.", nowIso: now.toISOString(), heating: null, day: empty, ...bare, energy: null, costs: { state: "no-tariff" } }
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

export async function setPlan(change: PlanChange): Promise<void> {
  if (demoMode()) {
    const plan = demoState().plan
    Object.assign(plan, change)
    if (change.testSeries) plan.testStep = 0
    return
  }
  await applyPlan(change)
}

/** The plan as it is right now, for checking a change against. */
export async function currentPlan(): Promise<PlanState> {
  if (demoMode()) return demoState().plan
  return parsePlan(await getStates())
}
