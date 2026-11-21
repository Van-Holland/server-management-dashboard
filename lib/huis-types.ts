/**
 * What the Heating and energy page shows, as plain data (added 2026-11-21). No server-only imports here, so the browser side can use it too.
 * The numbers come from Home Assistant (lib/huis.ts). Plan and decisions: vault IT/Projects/Linux Home Server/Heating - Home Assistant Plan.md.
 */

/** The three away-mode choices, exactly as the Home Assistant helper `input_select.verwarming_weg_modus` spells them. */
export const AWAY_MODES = ["Thuis", "Kort weg", "Lang weg"] as const
export type AwayMode = (typeof AWAY_MODES)[number]

export type HeatingState = {
  roomTemp: number | null
  /** The setpoint now. Null when the thermostat is off (frost protection). */
  target: number | null
  hvacMode: "auto" | "heat" | "off" | "unknown"
  /** "clock_program_1", "manual" or "anti_frost". */
  preset: string | null
  action: "heating" | "idle" | "off" | "unknown"
  awayMode: AwayMode | null
  /** Local time, "YYYY-MM-DD HH:MM:SS", or null when no return time is set. */
  awayUntil: string | null
}

export type DayPoint = { min: number; room: number | null; target: number | null }

/** A stretch of a day in minutes since midnight. */
export type Span = { from: number; to: number }

/** Today (or yesterday) in detail: what the thermostat did, when the boiler fired, and how cold it was outside. */
export type DayDetail = { points: DayPoint[]; boiler: Span[]; outside: { min: number; t: number }[]; nowMin: number }

/**
 * One finished (or running) day, boiled down to numbers. Score = boiler hours (or gas m3 once the P1 reader is there)
 * divided by degree-days (18 minus the average outside temperature), so a cold day and a mild day compare fairly.
 */
export type DayStat = {
  date: string
  partial: boolean
  boilerMin: number
  /** Boiler minutes per hour of the day, 24 numbers. */
  hourMin: number[]
  outsideAvg: number | null
  degreeDays: number | null
  gasM3: number | null
  /** Boiler hours per degree-day, null when it was too mild to mean anything. */
  scoreHours: number | null
  /** Gas m3 per degree-day, null until the gas meter exists. */
  scoreGas: number | null
  /** The night cycle that ended this evening: 22:00 yesterday to 22:00 today, filed under the night setting that held in between. */
  night: { target: number | null; boilerMin: number; outsideAvg: number | null; degreeDays: number | null; gasM3: number | null; scoreHours: number | null; scoreGas: number | null } | null
  /** Minutes from the first big target rise of the day until the room was near it. */
  warmupMin: number | null
  warmupTarget: number | null
}

export const DEGREE_DAY_BASE = 18

/** The plan the Home Assistant rules follow, kept in helpers on the Home Assistant side. */
export type PlanState = {
  /** False until the helpers are installed in Home Assistant. */
  available: boolean
  dayTemp: number | null
  nightTemp: number | null
  /** "HH:MM" */
  dayStart: string | null
  eveningStart: string | null
  nightStart: string | null
  testOn: boolean
  testSeries: number[]
  testStep: number
}

export type EnergyState = {
  powerW: number | null
  powerSeries: { min: number; w: number }[]
  todayKwh: number | null
  todayM3: number | null
  /** One entry per hour of today that has started; m3 used in that hour. */
  gasHours: { hour: number; m3: number }[]
  /** Which meters Home Assistant does not know yet ("power", "electricity", "gas"). */
  missing: string[]
}

export type CostBreakdown = { electricity: number; gas: number; fixed: number; total: number; kwh: number; m3: number; days: number }

export type CostState =
  | { state: "ok"; today: CostBreakdown; month: CostBreakdown; since: string }
  | { state: "not-started"; startsOn: string }
  | { state: "no-tariff" }
  | { state: "no-data" }

export type HuisSnapshot = {
  source: "live" | "demo" | "unconfigured" | "error"
  message?: string
  nowIso: string
  heating: HeatingState | null
  day: DayDetail
  yesterday: DayDetail | null
  /** Oldest first; the last one is today (partial). */
  days: DayStat[]
  outsideNow: number | null
  plan: PlanState
  energy: EnergyState | null
  costs: CostState
}

/**
 * One price period. Prices include 21 % VAT and energy tax; `fixedPerMonth` is everything that does not depend on use,
 * added up: delivery fee + grid fee for electricity and gas, minus the energy-tax reduction (so it can be negative per
 * fuel, but is the net amount for both). The yearly discount is not in here: the supplier settles it on the annual bill.
 */
export type TariffPeriod = {
  /** First day this period counts, "YYYY-MM-DD". */
  from: string
  electricityPerKwh: number
  gasPerM3: number
  fixedPerMonth: number
  note?: string
}
