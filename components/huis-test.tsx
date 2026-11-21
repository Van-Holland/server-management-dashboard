"use client"

import { useState } from "react"
import { BOILER, focusRing, send, shortDate } from "@/components/huis-shared"
import type { DayStat, PlanState } from "@/lib/huis-types"

/**
 * The Night test tab. The night temperature rotates each evening through a list (15, 17, 16, 18 ...), and every night is scored
 * as use per degree-day, so a cold night and a mild night compare fairly. Lower score = cheaper for the cold you had.
 * The rotation itself runs inside Home Assistant; this tab switches it on and off, sets the list and reads the results.
 */

type Group = { target: number; nights: DayStat[]; score: number | null; boilerMin: number; outside: number | null }

export function groupNights(days: DayStat[], useGas: boolean): Group[] {
  const by = new Map<number, DayStat[]>()
  for (const d of days) {
    const n = d.night
    if (!n || n.target === null) continue
    const sc = useGas ? n.scoreGas : n.scoreHours
    if (sc === null) continue
    by.set(n.target, [...(by.get(n.target) ?? []), d])
  }
  const avg = (list: number[]) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : null)
  return [...by.entries()]
    .map(([target, nights]) => ({
      target,
      nights,
      score: avg(nights.map((d) => (useGas ? d.night!.scoreGas : d.night!.scoreHours) as number)),
      boilerMin: avg(nights.map((d) => d.night!.boilerMin)) ?? 0,
      outside: avg(nights.map((d) => d.night!.outsideAvg).filter((v): v is number => v !== null)),
    }))
    .sort((a, b) => a.target - b.target)
}

export function TestTab({ plan, days, refresh }: { plan: PlanState; days: DayStat[]; refresh: () => void }) {
  const [text, setText] = useState(plan.testSeries.join(", "))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const useGas = days.some((d) => d.night?.scoreGas != null)
  const groups = groupNights(days, useGas)
  const best = groups.filter((g) => g.score !== null && g.nights.length >= 3).sort((a, b) => (a.score as number) - (b.score as number))[0]
  const maxScore = Math.max(0.01, ...groups.map((g) => g.score ?? 0))
  const next = plan.testSeries[plan.testStep % plan.testSeries.length]

  async function change(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    const failed = await send("/api/huis/plan", "POST", body)
    setBusy(false)
    if (failed) return setError(failed)
    window.setTimeout(refresh, 1200)
  }
  function saveSeries() {
    const list = text.split(/[,\s;]+/).map((v) => Number(v.replace(",", "."))).filter((n) => Number.isFinite(n))
    void change({ testSeries: list })
  }

  return (
    <div>
      {!plan.available ? <p className="mb-3 rounded-xl border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">The test switch needs the plan helpers in Home Assistant. Results below still show every night the thermostat has recorded.</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !plan.available}
          aria-pressed={plan.testOn}
          onClick={() => change({ testOn: !plan.testOn })}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-50 ${focusRing} ${plan.testOn ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:bg-secondary"}`}
        >
          {plan.testOn ? "Test is on" : "Start the test"}
        </button>
        <p className="text-sm text-muted-foreground">
          {plan.testOn ? `Tonight's night temperature: ${next}°. It changes every evening, 5 minutes before the night starts.` : "Off: the night temperature stays what the Plan tab says."}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">
          Night temperatures, in turn
          <input value={text} onChange={(e) => setText(e.target.value)} className={`mt-1 block w-52 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground ${focusRing}`} />
        </label>
        <button type="button" disabled={busy || !plan.available} onClick={saveSeries} className={`rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50 ${focusRing}`}>
          Save list
        </button>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}

      <h3 className="mt-6 text-sm font-medium text-muted-foreground">Results so far ({useGas ? "gas m³" : "boiler hours"} per degree-day, lower is cheaper)</h3>
      {groups.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No scored nights yet. A night needs outside temperature data and an outside average below 18°. Check back after a few nights.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {groups.map((g) => (
            <li key={g.target} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 text-sm">
              <span className="font-medium text-foreground">{g.target}°</span>
              <span className="h-3 rounded-full bg-secondary">
                <span className="block h-3 rounded-full" style={{ width: `${((g.score ?? 0) / maxScore) * 100}%`, background: BOILER, opacity: 0.85 }} />
              </span>
              <span className="text-xs text-muted-foreground">
                {g.score !== null ? g.score.toFixed(2) : "—"} · {g.nights.length} night{g.nights.length === 1 ? "" : "s"}{g.outside !== null ? ` · ${g.outside.toFixed(1)}° out` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-foreground">
        {best ? `Cheapest so far: ${best.target}° at night (${(best.score as number).toFixed(2)} per degree-day over ${best.nights.length} nights).` : "A winner needs at least 3 nights per temperature."}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Fair, not perfect: sun, wind, the wood stove and who is home also change a night. That is why the temperatures take turns instead of running one week each. A cheaper night can mean a colder morning: check the warm-up time on the Today tab.
      </p>

      {groups.length > 0 ? (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Every night</summary>
          <ul className="mt-2 space-y-1">
            {[...days].reverse().filter((d) => d.night?.target != null).map((d) => (
              <li key={d.date}>
                {shortDate(d.date)}: {d.night!.target}° · boiler {d.night!.boilerMin} min · outside {d.night!.outsideAvg ?? "—"}° · score {(useGas ? d.night!.scoreGas : d.night!.scoreHours)?.toFixed(2) ?? "—"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
