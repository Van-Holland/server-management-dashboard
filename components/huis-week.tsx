"use client"

import { useState } from "react"
import { BOILER, focusRing, hoursText, shortDate } from "@/components/huis-shared"
import type { DayStat } from "@/lib/huis-types"

/**
 * The Week tab: the last 7 days as bars (boiler hours, or gas m3 once the P1 reader reports it) with the score on top.
 * Score = use divided by degree-days, so a cold day and a mild day compare fairly. Lower is better.
 */

const W = 640
const H = 210

export function WeekTab({ days }: { days: DayStat[] }) {
  const week = days.slice(-7)
  const hasGas = week.some((d) => d.gasM3 !== null)
  const [unit, setUnit] = useState<"hours" | "gas">(hasGas ? "gas" : "hours")
  const useGas = unit === "gas" && hasGas
  const valueOf = (d: DayStat) => (useGas ? d.gasM3 : d.boilerMin / 60)
  const scoreOf = (d: DayStat) => (useGas ? d.scoreGas : d.scoreHours)
  const unitText = useGas ? "m³" : "h"

  const values = week.map(valueOf)
  const maxV = Math.max(0.1, ...values.map((v) => v ?? 0))
  const scores = week.map(scoreOf)
  const known = scores.filter((s): s is number => s !== null)
  const sMin = Math.min(...known)
  const sMax = Math.max(...known)
  const band = 12
  const plotH = H - 34
  const barMax = 110
  const lineRange = 50
  const slot = (W - 20) / Math.max(1, week.length)
  const barW = Math.min(46, slot - 14)

  if (week.length === 0) return <p className="text-sm text-muted-foreground">No days yet. They appear as Home Assistant records the thermostat.</p>

  const scorePath = scores
    .map((s, i) => (s === null ? null : `${(10 + i * slot + slot / 2).toFixed(1)},${(band + (known.length > 1 && sMax > sMin ? (1 - (s - sMin) / (sMax - sMin)) * lineRange : lineRange / 2)).toFixed(1)}`))
    .filter(Boolean)
    .map((pt, i) => `${i === 0 ? "M" : "L"}${pt}`)
    .join(" ")

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Bars: {useGas ? "gas" : "boiler hours"} per day. Line: score, use per degree-day (a lower point is better).
        </p>
        {hasGas ? (
          <div className="flex gap-1 rounded-lg border border-border p-0.5" role="group" aria-label="Unit">
            {(["gas", "hours"] as const).map((u) => (
              <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)} className={`rounded-md px-2.5 py-1 text-xs ${focusRing} ${unit === u ? "bg-secondary font-medium text-foreground" : "text-muted-foreground"}`}>
                {u === "gas" ? "Gas m³" : "Boiler hours"}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Gas in m³ joins here when the P1 reader is connected.</p>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full" role="img" aria-label="Boiler use and score per day, last 7 days">
        {week.map((d, i) => {
          const v = valueOf(d) ?? 0
          const h = (v / maxV) * barMax
          const cx = 10 + i * slot + slot / 2
          return (
            <g key={d.date}>
              <rect x={cx - barW / 2} y={H - 20 - h} width={barW} height={Math.max(1, h)} rx={3} fill={BOILER} opacity={d.partial ? 0.4 : 0.85} />
              <text x={cx} y={H - 22 - h - 3} textAnchor="middle" fontSize="10" fill="var(--foreground)">{v.toFixed(useGas ? 1 : 1)}</text>
              <text x={cx} y={H - 5} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{shortDate(d.date).split(" ")[0]}{d.partial ? "*" : ""}</text>
            </g>
          )
        })}
        {scorePath ? <path d={scorePath} fill="none" stroke="var(--foreground)" strokeWidth={1.8} strokeLinejoin="round" /> : null}
      </svg>
      <p className="text-xs text-muted-foreground">* not a full day. Bars are in {unitText} per day.</p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-normal">Day</th>
              <th className="py-1 pr-3 font-normal">Outside avg</th>
              <th className="py-1 pr-3 font-normal">Degree-days</th>
              <th className="py-1 pr-3 font-normal">{useGas ? "Gas" : "Boiler"}</th>
              <th className="py-1 font-normal">Score</th>
            </tr>
          </thead>
          <tbody>
            {[...week].reverse().map((d) => (
              <tr key={d.date} className="border-t border-border">
                <td className="py-1.5 pr-3 text-foreground">{shortDate(d.date)}{d.partial ? " (incomplete)" : ""}</td>
                <td className="py-1.5 pr-3">{d.outsideAvg !== null ? `${d.outsideAvg.toFixed(1)}°` : "—"}</td>
                <td className="py-1.5 pr-3">{d.degreeDays !== null ? d.degreeDays.toFixed(1) : "—"}</td>
                <td className="py-1.5 pr-3">{useGas ? (d.gasM3 !== null ? `${d.gasM3.toFixed(1)} m³` : "—") : hoursText(d.boilerMin)}</td>
                <td className="py-1.5">{scoreOf(d) !== null ? `${scoreOf(d)!.toFixed(2)} ${useGas ? "m³" : "h"}/dd` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Degree-days = 18 minus the average outside temperature. A day warmer than 17° has too few to give a score.</p>
    </div>
  )
}
