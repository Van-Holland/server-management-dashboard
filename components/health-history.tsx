"use client"

import { useEffect, useRef, useState } from "react"
import { dayMs, formatDuration, whenMs } from "@/lib/internet-format"
import { isEcho } from "@/lib/health-kinds"
import type { FixedInfo, HealthHistory, KindedEvent, Level } from "@/lib/health-history"

/**
 * The History section of the Health page (added 2026-10-22): what came up and went away again, so a problem that fixed itself
 * is still on record and can be investigated until it stops coming back. Written by lib/health-history.ts.
 *
 * Things that are still wrong are NOT listed here: they are in the section above. One row per alert (grouped by warning id, redesigned
 * 2026-10-23): title, how many times, when it was last seen. Click a row to open every time it happened. The default view is
 * deliberately small: only faults that are not yet fixed, the 6 most recent alerts. Behind "Show everything" sit the chores (updates,
 * expiring keys), the short stops (blips) and the problems marked fixed in fixed.json, which carry a green "Fixed" badge.
 */

const DOT: Record<Level, string> = { alert: "bg-usage-high", maintenance: "bg-usage-mid" }
const SHOWN = 6
const SHOWN_ALL = 60
const OFTEN_COUNT = 3
const OFTEN_WINDOW_MS = 7 * 86400000

function Dot({ level }: { level: Level }) {
  return <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[level]}`} aria-hidden="true" />
}

/** The green "Fixed" badge. With a story in fixed.json it is a button that opens a small pop-over next to it (closes on a click
 *  outside, on Esc, or on the badge again); without one it is a plain label. */
function FixedBadge({ f }: { f: FixedInfo }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const hasStory = Boolean(f.what || f.did || f.learn)

  useEffect(() => {
    if (!open) return
    const away = (ev: MouseEvent) => {
      if (box.current && !box.current.contains(ev.target as Node)) setOpen(false)
    }
    const esc = (ev: KeyboardEvent) => ev.key === "Escape" && setOpen(false)
    document.addEventListener("mousedown", away)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("mousedown", away)
      document.removeEventListener("keydown", esc)
    }
  }, [open])

  const label = `Fixed ${dayMs(f.ms)}`
  const pill = "rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-usage-low"
  if (!hasStory) return <span className={pill}>{label}</span>
  return (
    <span ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`${pill} cursor-pointer transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      >
        {label}
      </button>
      {open && (
        <span role="dialog" aria-label={f.note} className="panel absolute right-0 top-full z-20 mt-2 block w-72 max-w-[calc(100vw-2rem)] rounded-[14px] p-4 text-left shadow-lg">
          <span className="block text-sm font-medium text-foreground">{f.note}</span>
          {([["What happened", f.what], ["What we did", f.did], ["What to learn", f.learn]] as const).map(
            ([head, text]) =>
              text && (
                <span key={head} className="mt-2.5 block">
                  <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{head}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-foreground">{text}</span>
                </span>
              ),
          )}
        </span>
      )}
    </span>
  )
}

type Group = {
  id: string
  title: string
  level: Level
  events: KindedEvent[] // newest first
  lastMs: number
  totalMs: number
  often: boolean
  active: boolean
  fixed: FixedInfo | null
}

function Occurrence({ e }: { e: KindedEvent }) {
  const end = e.endMs ?? e.startMs
  // An echo warning stays up for a while after the event, so its own length says nothing about the fault: show only when it was reported.
  const when = e.echo ? `reported ${whenMs(e.startMs)}` : `${whenMs(e.startMs)} to ${whenMs(end)} · ${formatDuration(Math.max(60, Math.round((end - e.startMs) / 1000)))}`
  return (
    <li className="py-1.5 text-xs text-muted-foreground">
      {when}
      {e.blip && " · short stop"}
    </li>
  )
}

function GroupRow({ g, nowMs }: { g: Group; nowMs: number }) {
  const [open, setOpen] = useState(false)
  const n = g.events.length
  const echo = isEcho(g.id)
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <Dot level={g.level} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="block text-sm text-foreground">{g.title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {n} {n === 1 ? "time" : "times"}
            {echo ? "" : ` · ${formatDuration(Math.max(60, Math.round(g.totalMs / 1000)))} in total`} · last {g.active ? "now" : whenMs(g.lastMs)}
            {g.fixed && ` · ${g.fixed.note}`}
            <span className="ml-1.5 text-[11px]">{open ? "▲ hide" : "▼ show each time"}</span>
          </span>
        </button>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {g.fixed && <FixedBadge f={g.fixed} />}
          {!g.fixed && g.often && <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-usage-mid">keeps coming back</span>}
          {g.active && <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">active now</span>}
        </div>
      </div>
      {open && (
        <ul className="ml-5 mt-2 divide-y divide-border border-l border-border pl-3">
          {g.events.map((e, i) => (
            <Occurrence key={`${e.startMs}-${i}`} e={e} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function HealthHistorySection({ history, nowMs }: { history: HealthHistory; nowMs: number }) {
  const [everything, setEverything] = useState(false)
  // The default view: unfixed faults only. "Show everything" adds chores, short stops and fixed problems (with their badge).

  // Only what came up and went away again is listed: anything still active is already in the section above. An alert that is active
  // right now AND has earlier history gets a row with an "active now" badge.
  const plain = (x: { kind: "fault" | "chore"; fixed: FixedInfo | null; blip?: boolean }) => x.kind === "fault" && !x.fixed && !x.blip
  const gone = history.timeline.filter((e) => e.endMs !== null)
  const activeIds = new Set(history.timeline.filter((e) => e.endMs === null).map((e) => e.id))
  const shownEvents = gone.filter((e) => everything || plain(e))
  const hiddenCount = new Set(gone.map((e) => e.id)).size - new Set(gone.filter(plain).map((e) => e.id)).size
  const fixedCount = new Set(gone.filter((e) => e.fixed).map((e) => e.id)).size

  const byId = new Map<string, KindedEvent[]>()
  for (const e of shownEvents) byId.set(e.id, [...(byId.get(e.id) ?? []), e]) // timeline is newest first, so each list is too
  const groups: Group[] = [...byId.entries()]
    .map(([id, ev]) => ({
      id,
      title: ev[0].title,
      level: ev.some((e) => e.level === "alert") ? ("alert" as Level) : ("maintenance" as Level),
      events: ev,
      lastMs: Math.max(...ev.map((e) => e.endMs ?? e.startMs)),
      totalMs: ev.reduce((sum, e) => sum + ((e.endMs ?? e.startMs) - e.startMs), 0),
      often: ev.filter((e) => nowMs - e.startMs < OFTEN_WINDOW_MS && !e.blip).length >= OFTEN_COUNT,
      active: activeIds.has(id),
      fixed: ev.every((e) => e.fixed) ? ev[0].fixed : null, // fixed only if EVERY listed occurrence is from before the fix
    }))
    .sort((a, b) => b.lastMs - a.lastMs)
  const limit = everything ? SHOWN_ALL : SHOWN
  const lastAgoMin = history.lastRecordedMs === null ? null : Math.round((nowMs - history.lastRecordedMs) / 60000)
  const stale = lastAgoMin === null || lastAgoMin > 30

  return (
    <section aria-labelledby="history-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="history-heading" className="text-sm font-medium text-muted-foreground">
          History
        </h2>
        <button
          type="button"
          onClick={() => setEverything((v) => !v)}
          aria-pressed={everything}
          className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {everything ? "Show less" : `Show everything${hiddenCount > 0 ? ` (+${hiddenCount})` : ""}`}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {everything ? "Every alert that came up and went away again" : "Alerts that came up and went away again and are not fixed yet"}, last 90 days. Click one to see each time.
        {history.recordingSinceMs !== null && ` Recording since ${dayMs(history.recordingSinceMs)}.`}
      </p>
      {stale && (
        <p className="mt-2 text-xs text-usage-mid">
          {lastAgoMin === null
            ? "Nothing has been recorded yet. A job on the server asks the dashboard every 5 minutes (POST /api/health/record)."
            : `The last recording was ${lastAgoMin} minutes ago. Check the cron job on mulderserver that calls /api/health/record.`}
        </p>
      )}

      <div className="panel mt-3 rounded-[14px] p-4">
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {everything ? "Nothing has gone away again yet." : "No open fault in the history."} Things still active are in the section above.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {groups.slice(0, limit).map((g) => (
                <GroupRow key={g.id} g={g} nowMs={nowMs} />
              ))}
            </ul>
            {groups.length > limit && <p className="mt-2 text-xs text-muted-foreground">{groups.length - limit} older alerts not shown.</p>}
          </>
        )}
      </div>
      {!everything && fixedCount > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {fixedCount} fixed {fixedCount === 1 ? "problem is" : "problems are"} left out here. They are in Show everything, with a green Fixed badge.
        </p>
      )}
    </section>
  )
}
