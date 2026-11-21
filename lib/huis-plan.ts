import { callService, type HaState } from "@/lib/ha"
import { TEMP_MAX, TEMP_MIN } from "@/lib/huis-config"
import type { PlanState } from "@/lib/huis-types"

/**
 * The heating plan: day and night temperature, the three switch times and the night test (added 2026-11-21).
 * They live in helpers inside Home Assistant (config/packages/heating_plan.yaml); the Home Assistant rules read them.
 * Until those helpers are installed, `available` is false and the Plan tab says so.
 */

export const PLAN = {
  dayTemp: "input_number.verwarming_dag_temp",
  nightTemp: "input_number.verwarming_nacht_temp",
  dayStart: "input_datetime.verwarming_dag_start",
  eveningStart: "input_datetime.verwarming_avond_start",
  nightStart: "input_datetime.verwarming_nacht_start",
  testOn: "input_boolean.verwarming_test_aan",
  testSeries: "input_text.verwarming_test_reeks",
  testStep: "input_number.verwarming_test_stap",
} as const

export const emptyPlan: PlanState = { available: false, dayTemp: null, nightTemp: null, dayStart: null, eveningStart: null, nightStart: null, testOn: false, testSeries: [15, 17, 16, 18], testStep: 0 }

const num = (v: unknown) => {
  const n = Number(v)
  return v !== null && v !== "" && Number.isFinite(n) ? n : null
}
const hhmm = (s: string | undefined) => (s && /^\d{2}:\d{2}/.test(s) ? s.slice(0, 5) : null)

export function parseSeries(text: string): number[] {
  return text
    .split(/[,\s;]+/)
    .map((x) => Number(x.replace(",", ".")))
    .filter((n) => Number.isFinite(n))
}

export function parsePlan(states: HaState[]): PlanState {
  const get = (id: string) => states.find((s) => s.entity_id === id)
  const dayTemp = get(PLAN.dayTemp)
  const nightTemp = get(PLAN.nightTemp)
  if (!dayTemp || !nightTemp || dayTemp.state === "unavailable" || nightTemp.state === "unavailable") return emptyPlan
  const series = parseSeries(get(PLAN.testSeries)?.state ?? "")
  return {
    available: true,
    dayTemp: num(dayTemp.state),
    nightTemp: num(nightTemp.state),
    dayStart: hhmm(get(PLAN.dayStart)?.state),
    eveningStart: hhmm(get(PLAN.eveningStart)?.state),
    nightStart: hhmm(get(PLAN.nightStart)?.state),
    testOn: get(PLAN.testOn)?.state === "on",
    testSeries: series.length > 0 ? series : emptyPlan.testSeries,
    testStep: num(get(PLAN.testStep)?.state) ?? 0,
  }
}

export type PlanChange = Partial<{ dayTemp: number; nightTemp: number; dayStart: string; eveningStart: string; nightStart: string; testOn: boolean; testSeries: number[] }>

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** Checks what the browser sent. `current` is the plan as it is now, so one changed time can be checked against the other two. */
export function validatePlan(input: unknown, current: PlanState): { ok: true; change: PlanChange } | { ok: false; error: string } {
  const body = (input ?? {}) as Record<string, unknown>
  const change: PlanChange = {}
  for (const key of ["dayTemp", "nightTemp"] as const) {
    if (body[key] === undefined) continue
    const n = body[key]
    if (typeof n !== "number" || !Number.isFinite(n) || n < TEMP_MIN || n > TEMP_MAX) return { ok: false, error: `Choose a temperature between ${TEMP_MIN} and ${TEMP_MAX}.` }
    change[key] = Math.round(n * 2) / 2
  }
  for (const key of ["dayStart", "eveningStart", "nightStart"] as const) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== "string" || !TIME.test(body[key] as string)) return { ok: false, error: "A time looks like 06:00." }
    change[key] = body[key] as string
  }
  if (body.testOn !== undefined) {
    if (typeof body.testOn !== "boolean") return { ok: false, error: "Test on or off, nothing else." }
    change.testOn = body.testOn
  }
  if (body.testSeries !== undefined) {
    const list = body.testSeries
    if (!Array.isArray(list) || list.length < 2 || list.length > 8 || !list.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 10 && n <= 22))
      return { ok: false, error: "The test needs 2 to 8 night temperatures between 10 and 22." }
    change.testSeries = list.map((n: number) => Math.round(n * 2) / 2)
  }
  const merged = { dayStart: change.dayStart ?? current.dayStart, eveningStart: change.eveningStart ?? current.eveningStart, nightStart: change.nightStart ?? current.nightStart }
  if (merged.dayStart && merged.eveningStart && merged.nightStart) {
    const [d, e, n] = [minutes(merged.dayStart), minutes(merged.eveningStart), minutes(merged.nightStart)]
    if (!(d < e && e < n)) return { ok: false, error: "The times must go in order: day, then evening, then night." }
  }
  if (Object.keys(change).length === 0) return { ok: false, error: "Nothing to change." }
  return { ok: true, change }
}

/** Writes a change into the Home Assistant helpers. */
export async function applyPlan(change: PlanChange): Promise<void> {
  if (change.dayTemp !== undefined) await callService("input_number", "set_value", { entity_id: PLAN.dayTemp, value: change.dayTemp })
  if (change.nightTemp !== undefined) await callService("input_number", "set_value", { entity_id: PLAN.nightTemp, value: change.nightTemp })
  for (const [key, id] of [["dayStart", PLAN.dayStart], ["eveningStart", PLAN.eveningStart], ["nightStart", PLAN.nightStart]] as const) {
    const t = change[key]
    if (t !== undefined) await callService("input_datetime", "set_datetime", { entity_id: id, time: `${t}:00` })
  }
  if (change.testSeries !== undefined) {
    await callService("input_text", "set_value", { entity_id: PLAN.testSeries, value: change.testSeries.join(",") })
    await callService("input_number", "set_value", { entity_id: PLAN.testStep, value: 0 })
  }
  if (change.testOn !== undefined) await callService("input_boolean", change.testOn ? "turn_on" : "turn_off", { entity_id: PLAN.testOn })
}
