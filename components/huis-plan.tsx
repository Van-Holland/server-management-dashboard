"use client"

import { useState } from "react"
import { Minus, Plus } from "lucide-react"
import { focusRing, send } from "@/components/huis-shared"
import { TEMP_MAX, TEMP_MIN, TEMP_STEP } from "@/lib/huis-config"
import type { PlanState } from "@/lib/huis-types"

/**
 * The Plan tab: day and night temperature and the three switch times. They are stored in Home Assistant helpers and the
 * Home Assistant rules follow them. Nothing changes until you press Save.
 */

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.min(TEMP_MAX, Math.max(TEMP_MIN, v))
  const btn = `flex size-9 items-center justify-center rounded-full border border-border hover:bg-secondary ${focusRing}`
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-3">
        <button type="button" className={btn} aria-label={`Lower ${label}`} onClick={() => onChange(clamp(value - TEMP_STEP))}><Minus className="size-4" aria-hidden="true" /></button>
        <span className="min-w-14 text-center text-xl font-medium text-foreground">{value.toFixed(1)}°</span>
        <button type="button" className={btn} aria-label={`Raise ${label}`} onClick={() => onChange(clamp(value + TEMP_STEP))}><Plus className="size-4" aria-hidden="true" /></button>
      </div>
    </div>
  )
}

export function PlanTab({ plan, refresh }: { plan: PlanState; refresh: () => void }) {
  const [draft, setDraft] = useState({
    dayTemp: plan.dayTemp ?? 21,
    nightTemp: plan.nightTemp ?? 16,
    dayStart: plan.dayStart ?? "06:00",
    eveningStart: plan.eveningStart ?? "17:00",
    nightStart: plan.nightStart ?? "22:00",
  })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!plan.available) {
    return (
      <p className="rounded-xl border border-border bg-secondary px-3 py-3 text-sm text-muted-foreground">
        The plan helpers are not installed in Home Assistant yet, so this tab cannot save anything. They come with the heating rules update (<code>packages/heating_plan.yaml</code>).
      </p>
    )
  }

  const changed =
    draft.dayTemp !== plan.dayTemp || draft.nightTemp !== plan.nightTemp || draft.dayStart !== plan.dayStart || draft.eveningStart !== plan.eveningStart || draft.nightStart !== plan.nightStart
  const set = (patch: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setSaved(false)
  }

  async function save() {
    setBusy(true)
    setError(null)
    const failed = await send("/api/huis/plan", "POST", draft)
    setBusy(false)
    if (failed) return setError(failed)
    setSaved(true)
    window.setTimeout(refresh, 1200)
  }

  const time = (label: string, key: "dayStart" | "eveningStart" | "nightStart") => (
    <label className="text-xs text-muted-foreground">
      {label}
      <input type="time" value={draft[key]} onChange={(e) => set({ [key]: e.target.value })} className={`mt-1 block rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground ${focusRing}`} />
    </label>
  )

  return (
    <div>
      <div className="flex flex-wrap gap-8">
        <Stepper label="Day temperature" value={draft.dayTemp} onChange={(v) => set({ dayTemp: v })} />
        <Stepper label="Night temperature" value={draft.nightTemp} onChange={(v) => set({ nightTemp: v })} />
      </div>
      <div className="mt-5 flex flex-wrap gap-4">
        {time("Day starts", "dayStart")}
        {time("Evening starts", "eveningStart")}
        {time("Night starts", "nightStart")}
      </div>
      <div className="mt-5 flex items-center gap-3">
        <button type="button" disabled={busy || !changed} onClick={save} className={`rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 ${focusRing}`}>
          {busy ? "Saving…" : "Save plan"}
        </button>
        {saved ? <span className="text-sm text-muted-foreground">Saved. The rules use it from now on.</span> : null}
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      {plan.testOn ? <p className="mt-3 text-xs text-muted-foreground">The night test is on, so it overwrites the night temperature every evening, 5 minutes before the night starts.</p> : null}

      <ul className="mt-5 space-y-1 text-xs text-muted-foreground">
        <li>Day: at the day start the target is set to the day temperature, and checked every 2 hours (a higher manual choice is left alone).</li>
        <li>Evening: free. Heating the first floor by hand is not undone. In Manual mode the target drops to the night temperature at the evening start.</li>
        <li>Night: the target is held at the night temperature. Rules only run in Home mode, not when you are away.</li>
        <li>The Remeha app still has its own program. Keep it at the same times, or the app and Home Assistant take turns.</li>
      </ul>
    </div>
  )
}
