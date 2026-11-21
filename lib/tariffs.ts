import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { TariffPeriod } from "@/lib/huis-types"

/**
 * The energy prices Matthijs types in on the Tariffs screen (added 2026-11-21). A list of periods, each with a "valid from" date, so
 * a price change next year does not rewrite the cost of the months before it. Kept in one small JSON file in a folder on the host
 * (HUIS_DATA_DIR; /huis-data in the container, mounted from /home/matt/huis-data) so it survives rebuilds and is in the server backup.
 */

const dir = () => process.env.HUIS_DATA_DIR ?? (process.env.NODE_ENV === "production" ? "/huis-data" : path.join(process.cwd(), ".huis-data"))
const file = () => path.join(dir(), "tariffs.json")

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Returns the cleaned list, or an error message. Used for what the browser sends and for what is read back from disk. */
export function parseTariffs(input: unknown): { ok: true; periods: TariffPeriod[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "Expected a list of price periods." }
  if (input.length > 40) return { ok: false, error: "That is too many periods." }
  const periods: TariffPeriod[] = []
  for (const raw of input) {
    const p = raw as Partial<TariffPeriod>
    if (typeof p?.from !== "string" || !DATE.test(p.from) || Number.isNaN(Date.parse(p.from))) return { ok: false, error: "Each period needs a valid date, like 2026-12-06." }
    const nums = [p.electricityPerKwh, p.gasPerM3, p.fixedPerMonth]
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return { ok: false, error: "Prices must be numbers." }
    if (p.electricityPerKwh! < 0 || p.electricityPerKwh! > 5 || p.gasPerM3! < 0 || p.gasPerM3! > 20) return { ok: false, error: "A price looks wrong (per kWh 0 to 5, per m³ 0 to 20)." }
    if (Math.abs(p.fixedPerMonth!) > 1000) return { ok: false, error: "The fixed monthly amount looks wrong." }
    const note = typeof p.note === "string" ? p.note.trim().slice(0, 120) : undefined
    periods.push({ from: p.from, electricityPerKwh: p.electricityPerKwh!, gasPerM3: p.gasPerM3!, fixedPerMonth: p.fixedPerMonth!, ...(note ? { note } : {}) })
  }
  periods.sort((a, b) => a.from.localeCompare(b.from))
  for (let i = 1; i < periods.length; i++) if (periods[i].from === periods[i - 1].from) return { ok: false, error: "Two periods start on the same day." }
  return { ok: true, periods }
}

export async function readTariffs(): Promise<TariffPeriod[]> {
  try {
    const parsed = parseTariffs(JSON.parse(await readFile(file(), "utf8")))
    return parsed.ok ? parsed.periods : []
  } catch {
    return []
  }
}

export async function writeTariffs(periods: TariffPeriod[]): Promise<void> {
  await mkdir(dir(), { recursive: true })
  const tmp = `${file()}.tmp`
  await writeFile(tmp, JSON.stringify(periods, null, 2) + "\n", "utf8")
  await rename(tmp, file()) // a half-written file never replaces the good one
}

/** The period that counts on a day ("YYYY-MM-DD"): the one with the latest start date on or before it. */
export function activePeriod(periods: TariffPeriod[], day: string): TariffPeriod | null {
  let found: TariffPeriod | null = null
  for (const p of periods) if (p.from <= day) found = p
  return found
}
