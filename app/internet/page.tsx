import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { CopyButton } from "@/components/copy-button"
import { dayMs, formatDuration, whenMs, whereShort, whereText } from "@/lib/internet-format"
import { getInternetWatch, hourGrid, ziggoSummary } from "@/lib/internet-watch"

// Reads live files on every request; must never be frozen into a build-time snapshot.
export const dynamic = "force-dynamic"

const STALE_MS = 5 * 60 * 1000

function cellClass(secs: number): string {
  if (secs <= 0) return "bg-secondary/60"
  if (secs < 600) return "bg-usage-mid"
  return "bg-usage-high"
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel rounded-2xl p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

function Tick({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={`size-2 rounded-full ${ok ? "bg-usage-low" : "bg-usage-high"}`} aria-hidden="true" />
      {label}
    </span>
  )
}

export default async function InternetPage() {
  const w = await getInternetWatch()
  const nowMs = Date.now()

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col gap-8">
        <div>
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to dashboard
          </Link>
          <h1 className="mt-4 text-2xl font-semibold text-foreground">Internet</h1>
          <p className="mt-1 text-sm text-muted-foreground">When the home internet was down, for how long, and where it broke.</p>
        </div>

        {!w ? (
          <p className="text-sm text-muted-foreground">The internet watcher has not reported yet. It runs on the server every minute (internet-watch.py).</p>
        ) : (
          <Body w={w} nowMs={nowMs} />
        )}
      </div>
    </main>
  )
}

function Body({ w, nowMs }: { w: NonNullable<Awaited<ReturnType<typeof getInternetWatch>>>; nowMs: number }) {
  const s = w.status
  const stale = nowMs - Date.parse(s.updatedAtIso) > STALE_MS
  const since = Date.parse(s.watchingSinceIso)
  const watchedDays = (nowMs - Math.min(since, w.outages[0] ? w.outages[0].start * 1000 : since)) / 86400000
  const last30 = w.outages.filter((o) => nowMs / 1000 - o.end < 30 * 86400)
  const longest = last30.reduce((a, o) => (o.secs > a ? o.secs : a), 0)
  const grid = hourGrid(w.outages, nowMs, 14)
  const summary = ziggoSummary(w, nowMs)
  const state = stale ? "The watcher has stopped" : s.down ? "The internet is down" : "The internet is up"
  const dot = stale ? "bg-muted-foreground" : s.down ? "bg-usage-high" : "bg-usage-low"

  return (
    <>
      <section className="panel rounded-2xl p-5">
        <p className="flex items-center gap-2 text-base font-medium">
          <span className={`size-2.5 rounded-full ${dot}`} aria-hidden="true" />
          {state}
          {s.down && s.downSinceIso ? <span className="text-sm font-normal text-muted-foreground">since {whenMs(Date.parse(s.downSinceIso))}</span> : null}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <Tick ok={s.now.modem} label="Your modem" />
          <Tick ok={s.now.gateway} label="Ziggo's gateway" />
          <Tick ok={s.now.internet} label="The wider internet" />
          {s.now.rttMs !== null ? <span className="text-sm text-muted-foreground">{s.now.rttMs} ms</span> : null}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Checked every minute. Last check {whenMs(Date.parse(s.updatedAtIso))}. Watching since {dayMs(since)}; outages before that were added from older logs.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Outages, last 7 days" value={String(s.outages7d)} sub={s.outages7d > 0 ? formatDuration(s.downSecs7d) + " in total" : "none seen"} />
        <Stat label="Outages, last 30 days" value={String(s.outages30d)} sub={s.outages30d > 0 ? formatDuration(s.downSecs30d) + " in total" : "none seen"} />
        <Stat label="Longest, last 30 days" value={longest > 0 ? formatDuration(longest) : "none"} />
        <Stat
          label="Uptime"
          value={watchedDays >= 3 ? `${s.uptimePct30d}%` : "too early"}
          sub={watchedDays >= 3 ? "of the time watched, up to 30 days" : "shown after 3 days of watching"}
        />
      </section>

      <section>
        <h2 className="text-base font-medium text-foreground">When do outages happen?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Each row is a day, each square an hour (Amsterdam time). Red is 10 minutes or more down in that hour, orange is less.</p>
        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="flex items-center gap-2 pl-[88px] text-[10px] text-muted-foreground">
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="w-full text-left">
                  {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
                </span>
              ))}
            </div>
            {grid.days.map((d, row) => (
              <div key={d.key} className="mt-1 flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-muted-foreground">{d.label}</span>
                <div className="grid flex-1 grid-cols-24 gap-1" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                  {grid.cells[row].map((secs, h) => (
                    <span
                      key={h}
                      title={`${d.label}, ${String(h).padStart(2, "0")}:00${secs > 0 ? `: ${formatDuration(secs)} down` : ""}`}
                      className={`h-4 rounded-sm ${cellClass(secs)}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-base font-medium text-foreground">Outages</h2>
        <p className="mt-1 text-sm text-muted-foreground">An outage is the internet failing for at least 2 minutes in a row. Newest first.</p>
        {w.outages.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">None seen yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {[...w.outages].reverse().map((o) => (
              <li key={o.start} className="panel rounded-xl p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {whenMs(o.start * 1000)} to {new Date(o.end * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}
                    <span className="ml-2 font-normal text-muted-foreground">{formatDuration(o.secs)}</span>
                  </p>
                  <p className="text-xs font-medium text-muted-foreground">{whereShort(o.where)}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {whereText(o.where)}
                  {o.note ? ` ${o.note.charAt(0).toUpperCase() + o.note.slice(1)}.` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-base font-medium text-foreground">To show Ziggo</h2>
        <p className="mt-1 text-sm text-muted-foreground">Plain Dutch text with every outage and its times. Only what was measured.</p>
        <div className="mt-3">
          <CopyButton text={summary} label="Copy summary" />
        </div>
        <pre className="panel mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl p-4 text-xs text-muted-foreground">{summary}</pre>
      </section>

      <section className="text-xs text-muted-foreground">
        <p>
          How it is measured: every minute the server pings the modem, asks Ziggo's first gateway to answer (a packet that runs out of hops there; the gateway ignores direct pings),
          and pings 1.1.1.1 and 9.9.9.9. If the modem answers but Ziggo's gateway does not, the break is on the line or in Ziggo's network. If both answer but the internet does not, it is
          further out. The raw minute-by-minute log is kept for 90 days on the server.
        </p>
      </section>
    </>
  )
}
