"use client"

import { useState } from "react"
import { CircleAlert, Plus, Trash2 } from "lucide-react"
import type { TariffPeriod } from "@/lib/huis-types"

/**
 * The Tariffs screen (added 2026-11-21): a list of price periods, each with a "valid from" date. A new price next year is a new row, so
 * the cost of the months before it does not change. Prices include VAT and energy tax. The page keeps the text of each box as typed and
 * only turns it into numbers when you save; the server checks everything again (lib/tariffs.ts).
 */

type Row = { from: string; electricityPerKwh: string; gasPerM3: string; fixedPerMonth: string; note: string }

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const input = `mt-1 block w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground ${focusRing}`

const toRow = (p: TariffPeriod): Row => ({ from: p.from, electricityPerKwh: String(p.electricityPerKwh), gasPerM3: String(p.gasPerM3), fixedPerMonth: String(p.fixedPerMonth), note: p.note ?? "" })

export function HuisTariffs({ initial }: { initial: TariffPeriod[] }) {
  const [rows, setRows] = useState<Row[]>(initial.map(toRow))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const change = (index: number, field: keyof Row, value: string) => {
    setSaved(false)
    setRows((all) => all.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  async function save() {
    setError(null)
    setSaved(false)
    const periods = rows.map((r) => ({
      from: r.from,
      electricityPerKwh: Number(r.electricityPerKwh.replace(",", ".")),
      gasPerM3: Number(r.gasPerM3.replace(",", ".")),
      fixedPerMonth: Number(r.fixedPerMonth.replace(",", ".")),
      ...(r.note.trim() ? { note: r.note.trim() } : {}),
    }))
    setBusy(true)
    try {
      const response = await fetch("/api/huis/tariffs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periods }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) setError(typeof data?.error === "string" ? data.error : "That did not work.")
      else {
        setRows((data.periods as TariffPeriod[]).map(toRow))
        setSaved(true)
      }
    } catch {
      setError("The dashboard could not be reached.")
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No prices yet. Add the first period.</p> : null}

      {rows.map((row, index) => (
        <section key={index} className="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label={`Price period ${index + 1}`}>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs text-muted-foreground">
              Valid from
              <input type="date" value={row.from} onChange={(e) => change(index, "from", e.target.value)} className={input} />
            </label>
            <label className="text-xs text-muted-foreground">
              Electricity, € per kWh
              <input inputMode="decimal" value={row.electricityPerKwh} onChange={(e) => change(index, "electricityPerKwh", e.target.value)} className={input} />
            </label>
            <label className="text-xs text-muted-foreground">
              Gas, € per m³
              <input inputMode="decimal" value={row.gasPerM3} onChange={(e) => change(index, "gasPerM3", e.target.value)} className={input} />
            </label>
            <label className="text-xs text-muted-foreground">
              Fixed, € per month
              <input inputMode="decimal" value={row.fixedPerMonth} onChange={(e) => change(index, "fixedPerMonth", e.target.value)} className={input} />
            </label>
          </div>
          <div className="mt-3 flex items-end gap-3">
            <label className="flex-1 text-xs text-muted-foreground">
              Note (optional)
              <input value={row.note} onChange={(e) => change(index, "note", e.target.value)} maxLength={120} className={input} />
            </label>
            <button
              type="button"
              onClick={() => {
                setSaved(false)
                setRows((all) => all.filter((_, i) => i !== index))
              }}
              aria-label={`Remove period ${index + 1}`}
              className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${focusRing}`}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </div>
        </section>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setSaved(false)
            setRows((all) => [...all, { from: "", electricityPerKwh: "", gasPerM3: "", fixedPerMonth: "", note: "" }])
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary ${focusRing}`}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add a period
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className={`rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 ${focusRing}`}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {saved ? <span className="text-sm text-usage-low">Saved</span> : null}
      </div>

      {error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <div className="rounded-2xl border border-border p-4 text-sm text-muted-foreground sm:p-5">
        <p className="font-medium text-foreground">How to fill it in</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Use the prices that include VAT and energy tax (the &ldquo;all-in&rdquo; price per kWh and per m³ on your contract).</li>
          <li>
            Fixed per month is everything that does not depend on use, added up for electricity and gas: delivery fee, grid fee, minus the energy-tax reduction.
          </li>
          <li>Leave the yearly discount out. The supplier settles it on the annual bill.</li>
          <li>A price change is a new row with its start date. Earlier months keep the old price.</li>
          <li>Before the first start date the page shows no cost.</li>
        </ul>
      </div>
    </div>
  )
}
