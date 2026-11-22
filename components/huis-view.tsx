"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { CircleAlert, Minus, Plug, Plus, Settings2 } from "lucide-react"
import { card, focusRing, LINE, pad, send } from "@/components/huis-shared"
import { PlanTab } from "@/components/huis-plan"
import { TestTab } from "@/components/huis-test"
import { TodayTab } from "@/components/huis-today"
import { WeekTab } from "@/components/huis-week"
import { TEMP_MAX, TEMP_MIN, TEMP_STEP } from "@/lib/huis-config"
import { AWAY_MODES, type AwayMode, type CostBreakdown, type CostState, type EnergyState, type HeatingState, type HuisSnapshot, type PlanState } from "@/lib/huis-types"

/**
 * The Heating and energy page (added 2026-11-21, design 3 chosen by Matthijs): the heating with its controls, a bar of today's
 * schedule with the room temperature on top, and three cards for power, gas and cost. It asks /api/huis every 10 seconds.
 * Gas, power and cost wait for the P1 reader and say so until Home Assistant has those sensors.
 */

const euro = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" })

const AWAY_LABEL: Record<AwayMode, string> = { Thuis: "Home", "Kort weg": "Short away", "Lang weg": "Long away" }
const AWAY_HELP: Record<AwayMode, string> = {
  Thuis: "Normal: the schedule and the safety rules run.",
  "Kort weg": "Holds 16 °C until you are back.",
  "Lang weg": "Frost protection. The heating restarts 24 hours before you are back.",
}

function toInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function defaultUntil(mode: AwayMode): string {
  const d = new Date()
  if (mode === "Kort weg") {
    d.setHours(d.getHours() + 4, d.getMinutes() < 30 ? 30 : 60, 0, 0)
  } else {
    d.setDate(d.getDate() + 3)
    d.setHours(18, 0, 0, 0)
  }
  return toInput(d)
}
function showTime(local: string) {
  const d = new Date(local.replace(" ", "T"))
  return d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

// ---------- heating ----------

function statusOf(h: HeatingState): { label: string; tone: string } {
  if (h.hvacMode === "off") return { label: "Frost protection", tone: "text-muted-foreground" }
  if (h.action === "heating") return { label: "Heating", tone: "text-usage-high" }
  if (h.action === "idle") return { label: "Idle", tone: "text-muted-foreground" }
  return { label: "Unknown", tone: "text-muted-foreground" }
}
function modeText(h: HeatingState) {
  if (h.hvacMode === "off") return "Off (frost protection)"
  if (h.hvacMode === "heat") return "Manual"
  return h.preset ? `Clock program ${h.preset.replace("clock_program_", "")}` : "Automatic"
}

function HeatingCard({ heating, plan, refresh }: { heating: HeatingState; plan: PlanState; refresh: () => void }) {
  const [pending, setPending] = useState<number | null>(null)
  const [choice, setChoice] = useState<AwayMode | null>(null)
  const [until, setUntil] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const status = statusOf(heating)
  const target = pending ?? heating.target
  const off = heating.hvacMode === "off"
  const active: AwayMode = heating.awayMode ?? "Thuis"

  async function step(delta: number) {
    if (target === null) return
    const next = Math.min(TEMP_MAX, Math.max(TEMP_MIN, Math.round((target + delta) / TEMP_STEP) * TEMP_STEP))
    setPending(next)
    setError(null)
    const failed = await send("/api/huis/temperature", "POST", { temperature: next })
    if (failed) setError(failed)
    // The thermostat answers through Remeha's cloud, so it takes a moment before the new target shows.
    window.setTimeout(() => {
      setPending(null)
      refresh()
    }, 2500)
  }

  async function apply(mode: AwayMode, when: string | null) {
    setBusy(true)
    setError(null)
    const failed = await send("/api/huis/away", "POST", { mode, until: when })
    setBusy(false)
    if (failed) return setError(failed)
    setChoice(null)
    window.setTimeout(refresh, 2000)
  }

  function pick(mode: AwayMode) {
    setError(null)
    if (mode === "Thuis") {
      setChoice(null)
      if (active !== "Thuis") void apply("Thuis", null)
      return
    }
    setChoice(mode)
    setUntil(defaultUntil(mode))
  }

  const shown = choice ?? active
  return (
    <section className={card} aria-labelledby="heating-heading">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
        <div>
          <h2 id="heating-heading" className="text-sm font-medium text-muted-foreground">
            Heating
          </h2>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight text-foreground">{heating.roomTemp !== null ? `${heating.roomTemp.toFixed(1)}°` : "—"}</span>
            <span className={`text-sm font-medium ${status.tone}`}>{status.label}</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{modeText(heating)}</p>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => step(-TEMP_STEP)}
              disabled={off || target === null}
              aria-label="Lower the target by half a degree"
              className={`flex size-9 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-secondary disabled:opacity-40 ${focusRing}`}
            >
              <Minus className="size-4" aria-hidden="true" />
            </button>
            <p className="min-w-20 text-center">
              <span className="block text-xs text-muted-foreground">Target</span>
              <span className="text-lg font-medium text-foreground">{target !== null ? `${target.toFixed(1)}°` : "—"}</span>
            </p>
            <button
              type="button"
              onClick={() => step(TEMP_STEP)}
              disabled={off || target === null}
              aria-label="Raise the target by half a degree"
              className={`flex size-9 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-secondary disabled:opacity-40 ${focusRing}`}
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>
          {plan.available ? (
            <p className="mt-3 max-w-xs text-xs text-muted-foreground">
              The rules keep it at {plan.dayTemp}° or more from {plan.dayStart} to {plan.eveningStart}, and at {plan.nightTemp}° from {plan.nightStart} to morning. Change this on the Plan tab.
            </p>
          ) : (
            <p className="mt-3 max-w-xs text-xs text-muted-foreground">The safety rules keep it at 20° or more from 07:05 to 17:00, and at 16° from 22:05 to 05:29.</p>
          )}
        </div>

        <div className="w-full sm:w-auto sm:min-w-72">
          <p className="text-sm font-medium text-muted-foreground">Away mode</p>
          <div className="mt-2 flex gap-1 rounded-xl border border-border p-1" role="group" aria-label="Away mode">
            {AWAY_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={busy}
                onClick={() => pick(mode)}
                aria-pressed={shown === mode}
                className={`flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors ${focusRing} ${
                  shown === mode ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                } ${active === mode ? "ring-1 ring-brand/60" : ""}`}
              >
                {AWAY_LABEL[mode]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{AWAY_HELP[shown]}</p>

          {active !== "Thuis" && !choice && heating.awayUntil ? (
            <p className="mt-2 text-sm text-foreground">Back on {showTime(heating.awayUntil)}</p>
          ) : null}

          {choice ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-xs text-muted-foreground">
                Back on
                <input
                  type="datetime-local"
                  value={until}
                  onChange={(event) => setUntil(event.target.value)}
                  className={`mt-1 block rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground ${focusRing}`}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => apply(choice, until)}
                className={`rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 ${focusRing}`}
              >
                {busy ? "Saving…" : "Set away mode"}
              </button>
              <button type="button" onClick={() => setChoice(null)} className={`rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground ${focusRing}`}>
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-destructive">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </section>
  )
}

// ---------- power, gas, cost ----------

function Waiting({ what }: { what: string }) {
  return (
    <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
      <Plug className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>Waiting for the P1 reader. {what} appears here as soon as Home Assistant has it.</span>
    </p>
  )
}

function PowerCard({ energy }: { energy: EnergyState | null }) {
  const missing = !energy || energy.missing.includes("power")
  const series = energy?.powerSeries ?? []
  const maxW = Math.max(1000, ...series.map((p) => p.w))
  const path = series.map((p, i) => `${i === 0 ? "M" : "L"}${(((360 - p.min) / 360) * 160).toFixed(1)},${(36 - (p.w / maxW) * 34).toFixed(1)}`).join(" ")
  return (
    <section className={card} aria-labelledby="power-heading">
      <h2 id="power-heading" className="text-sm font-medium text-muted-foreground">
        Power
      </h2>
      {missing ? (
        <Waiting what="Your electricity use" />
      ) : (
        <>
          <p className="mt-2 text-2xl font-semibold text-foreground">{energy.powerW !== null ? `${Math.round(energy.powerW)} W` : "—"}</p>
          <p className="text-xs text-muted-foreground">{energy.todayKwh !== null ? `${energy.todayKwh.toFixed(1)} kWh today` : "Today's total is not known yet"}</p>
          <svg viewBox="0 0 160 38" className="mt-3 h-10 w-full" role="img" aria-label="Power over the last 6 hours">
            {path ? <path d={path} fill="none" stroke={LINE} strokeWidth={1.5} strokeLinejoin="round" /> : null}
          </svg>
          <p className="text-xs text-muted-foreground">Last 6 hours</p>
        </>
      )}
    </section>
  )
}

function GasCard({ energy }: { energy: EnergyState | null }) {
  const missing = !energy || energy.missing.includes("gas")
  const hours = energy?.gasHours ?? []
  const maxM3 = Math.max(0.5, ...hours.map((h) => h.m3))
  return (
    <section className={card} aria-labelledby="gas-heading">
      <h2 id="gas-heading" className="text-sm font-medium text-muted-foreground">
        Gas
      </h2>
      {missing ? (
        <Waiting what="Your gas use" />
      ) : (
        <>
          <p className="mt-2 text-2xl font-semibold text-foreground">{energy.todayM3 !== null ? `${energy.todayM3.toFixed(1)} m³` : "—"}</p>
          <p className="text-xs text-muted-foreground">today</p>
          <svg viewBox="0 0 160 38" className="mt-3 h-10 w-full" role="img" aria-label="Gas per hour today">
            {hours.map((h) => (
              <rect key={h.hour} x={h.hour * 6.6 + 1} y={36 - (h.m3 / maxM3) * 34} width={5} height={Math.max(1, (h.m3 / maxM3) * 34)} rx={1} fill={LINE} />
            ))}
          </svg>
          <p className="text-xs text-muted-foreground">Per hour, from midnight</p>
        </>
      )}
    </section>
  )
}

function CostCard({ costs }: { costs: CostState }) {
  const day = (c: CostBreakdown) => euro.format(c.total)
  return (
    <section className={card} aria-labelledby="cost-heading">
      <h2 id="cost-heading" className="text-sm font-medium text-muted-foreground">
        Cost
      </h2>
      {costs.state === "ok" ? (
        <>
          <p className="mt-2 text-2xl font-semibold text-foreground">{day(costs.today)}</p>
          <p className="text-xs text-muted-foreground">today · {euro.format(costs.month.total)} since {new Date(costs.since).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            This month: electricity {euro.format(costs.month.electricity)} · gas {euro.format(costs.month.gas)} · fixed {euro.format(costs.month.fixed)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">An estimate from your prices. The yearly discount is settled on the annual bill and is not in here.</p>
        </>
      ) : costs.state === "not-started" ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Costs start on {new Date(costs.startsOn).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}, when the new contract begins.
        </p>
      ) : costs.state === "no-data" ? (
        <Waiting what="The cost" />
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Add your prices to see the cost.{" "}
          <Link href="/huis/tariffs" className="text-foreground underline underline-offset-2">
            Open Tariffs
          </Link>
        </p>
      )}
    </section>
  )
}

// ---------- gas and cost tab ----------

function GasTab({ snapshot }: { snapshot: HuisSnapshot }) {
  const today = snapshot.days[snapshot.days.length - 1]
  const waiting = !snapshot.energy || snapshot.energy.missing.includes("gas")
  return (
    <div className="flex flex-col gap-4">
      {waiting ? (
        <p className="rounded-xl bg-secondary px-3 py-2 text-sm text-muted-foreground">
          Until the P1 reader is connected, the Week tab scores the boiler's running hours{today ? ` (today ${Math.floor(today.boilerMin / 60)} h ${pad(today.boilerMin % 60)} min)` : ""}. When Home Assistant has the gas meter, the numbers below fill in and the Week and Night test tabs switch to gas by themselves.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <PowerCard energy={snapshot.energy} />
        <GasCard energy={snapshot.energy} />
        <CostCard costs={snapshot.costs} />
      </div>
    </div>
  )
}

// ---------- the page ----------

const TABS = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "gas", label: "Gas and cost" },
  { id: "test", label: "Night test" },
  { id: "plan", label: "Plan" },
] as const
type TabId = (typeof TABS)[number]["id"]

export function HuisView({ initial }: { initial: HuisSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial)
  const [tab, setTab] = useState<TabId>("today")

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/huis", { cache: "no-store" })
      if (response.ok) setSnapshot((await response.json()) as HuisSnapshot)
    } catch {
      // Keep showing the last picture; the next poll tries again.
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(refresh, 10_000)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    const hash = window.location.hash.replace("#", "")
    if (TABS.some((t) => t.id === hash)) setTab(hash as TabId)
  }, [])
  const choose = (id: TabId) => {
    setTab(id)
    window.history.replaceState(null, "", `#${id}`)
  }

  const live = snapshot.source === "live" || snapshot.source === "demo"
  return (
    <div className="flex flex-col gap-4">
      {snapshot.source === "demo" ? (
        <p className="rounded-xl border border-border bg-secondary px-4 py-2 text-sm text-muted-foreground">Demo data: these numbers are made up.</p>
      ) : null}
      {snapshot.source === "unconfigured" || snapshot.source === "error" ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {snapshot.message}
        </p>
      ) : null}

      {snapshot.heating ? <HeatingCard heating={snapshot.heating} plan={snapshot.plan} refresh={refresh} /> : null}

      {live ? (
        <section className={card} aria-label="Details">
          <div role="tablist" aria-label="Heating and energy views" className="-mt-1 mb-4 flex gap-1 overflow-x-auto border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="tab-panel"
                onClick={() => choose(t.id)}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${focusRing} ${tab === t.id ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === "today" ? <TodayTab snapshot={snapshot} /> : null}
            {tab === "week" ? <WeekTab days={snapshot.days} /> : null}
            {tab === "gas" ? <GasTab snapshot={snapshot} /> : null}
            {tab === "test" ? <TestTab plan={snapshot.plan} days={snapshot.days} refresh={refresh} /> : null}
            {tab === "plan" ? <PlanTab plan={snapshot.plan} refresh={refresh} /> : null}
          </div>
        </section>
      ) : null}

      <p className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Updated {new Date(snapshot.nowIso).toLocaleTimeString("en-GB")}</span>
        <Link href="/huis/tariffs" className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 hover:text-foreground ${focusRing}`}>
          <Settings2 className="size-3.5" aria-hidden="true" />
          Tariffs
        </Link>
      </p>
    </div>
  )
}
