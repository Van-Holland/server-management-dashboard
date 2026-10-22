import { dayMs, formatDuration, whenMs } from "@/lib/internet-format"
import type { HealthEvent, HealthHistory, Level, RecurringRow } from "@/lib/health-history"

/**
 * The History section of the Health page (added 2026-10-22): what came up and went away again, so a problem that fixed itself
 * is still on record and can be investigated until it stops coming back. Written by lib/health-history.ts.
 */

const DOT: Record<Level, string> = { alert: "bg-usage-high", maintenance: "bg-usage-mid" }
const SHOWN = 20

function Dot({ level }: { level: Level }) {
  return <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[level]}`} aria-hidden="true" />
}

function Recurring({ row, nowMs }: { row: RecurringRow; nowMs: number }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <Dot level={row.level} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{row.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {row.count} times in 30 days · {formatDuration(Math.max(60, Math.round(row.totalMs / 1000)))} in total · last {row.active ? "now" : dayMs(row.lastMs)}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
        {row.often && <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-usage-mid">keeps coming back</span>}
        {row.active && <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">active now</span>}
      </div>
    </li>
  )
}

function Entry({ e, firstMs }: { e: HealthEvent; firstMs: number | null }) {
  const when =
    e.endMs === null
      ? e.startMs === firstMs
        ? "already active when recording began · still active"
        : `since ${whenMs(e.startMs)} · still active`
      : `${whenMs(e.startMs)} to ${whenMs(e.endMs)} · ${formatDuration(Math.max(60, Math.round((e.endMs - e.startMs) / 1000)))}`
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Dot level={e.level} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{e.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{when}</p>
      </div>
    </li>
  )
}

export function HealthHistorySection({ history, nowMs }: { history: HealthHistory; nowMs: number }) {
  const recurring = history.recurring.filter((r) => r.count >= 2)
  const lastAgoMin = history.lastRecordedMs === null ? null : Math.round((nowMs - history.lastRecordedMs) / 60000)
  const stale = lastAgoMin === null || lastAgoMin > 30
  return (
    <section aria-labelledby="history-heading">
      <h2 id="history-heading" className="text-sm font-medium text-muted-foreground">
        History
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        What came up and went away again, last 90 days.
        {history.recordingSinceMs !== null && ` Recording since ${dayMs(history.recordingSinceMs)}.`}
      </p>
      {stale && (
        <p className="mt-2 text-xs text-usage-mid">
          {lastAgoMin === null
            ? "Nothing has been recorded yet. A job on the server asks the dashboard every 5 minutes (POST /api/health/record)."
            : `The last recording was ${lastAgoMin} minutes ago. Check the cron job on mulderserver that calls /api/health/record.`}
        </p>
      )}

      {recurring.length > 0 && (
        <div className="panel mt-3 rounded-[14px] p-4">
          <h3 className="text-xs font-medium text-muted-foreground">Comes back, worth a fix</h3>
          <ul className="mt-1 divide-y divide-border">
            {recurring.map((r) => (
              <Recurring key={r.id} row={r} nowMs={nowMs} />
            ))}
          </ul>
        </div>
      )}

      <div className="panel mt-3 rounded-[14px] p-4">
        <h3 className="text-xs font-medium text-muted-foreground">Timeline</h3>
        {history.timeline.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing has come up since the recording began.</p>
        ) : (
          <>
            <ul className="mt-1 divide-y divide-border">
              {history.timeline.slice(0, SHOWN).map((e, i) => (
                <Entry key={`${e.id}-${e.startMs}-${i}`} e={e} firstMs={history.recordingSinceMs} />
              ))}
            </ul>
            {history.timeline.length > SHOWN && <p className="mt-2 text-xs text-muted-foreground">{history.timeline.length - SHOWN} older entries not shown.</p>}
          </>
        )}
      </div>
    </section>
  )
}
