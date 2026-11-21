/** Names and constants for the Heating and energy page (added 2026-11-21). */

export const HEATING = {
  climate: "climate.wgw_ot_on_off",
  awayMode: "input_select.verwarming_weg_modus",
  awayUntil: "input_datetime.verwarming_terug",
} as const

/**
 * The Remeha app's program, same every day (set by Matthijs 2026-11-21): 06:00 -> 21, 17:00 -> 16, 22:00 -> 16.
 * Drawn on the day bar. If the program in the app changes, change it here too; Home Assistant cannot read it.
 */
export const SCHEDULE_START_TARGET = 16
export const SCHEDULE_POINTS: { at: number; target: number }[] = [
  { at: 6 * 60, target: 21 },
  { at: 17 * 60, target: 16 },
  { at: 22 * 60, target: 16 },
]

export const TEMP_MIN = 10
export const TEMP_MAX = 25
export const TEMP_STEP = 0.5
