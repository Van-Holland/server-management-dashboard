import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { HealthHistorySection } from "@/components/health-history"
import { HealthOverview } from "@/components/health-overview"
import { getBackups } from "@/lib/backups"
import { getHealthSnapshot } from "@/lib/health"
import { buildChecks, splitWarnings, summarize } from "@/lib/health-checks"
import { getHealthHistory } from "@/lib/health-history"

// Reads live files and live services on every request; must never be frozen into a build-time snapshot.
export const dynamic = "force-dynamic"

const TONE = { ok: ["bg-usage-low", "text-usage-low"], maintenance: ["bg-usage-mid", "text-usage-mid"], alert: ["bg-usage-high", "text-usage-high"] } as const

export default async function HealthPage() {
  const [snapshot, backups, history] = await Promise.all([getHealthSnapshot(), getBackups(), getHealthHistory(Date.now())])
  const checks = buildChecks(snapshot, backups, snapshot.checkedMs)
  const summary = summarize(checks, splitWarnings(snapshot, backups))
  const [dot, text] = TONE[summary.status]
  const reported = snapshot.host.probe ? Math.max(0, Math.round((snapshot.checkedMs - Date.parse(snapshot.host.probe.ranAtIso)) / 60000)) : null

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col gap-8">
        <div>
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to dashboard
          </Link>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Health</h1>
              <p className="mt-1 text-sm text-muted-foreground">Everything the dashboard watches, and what it found.</p>
            </div>
            <p className="flex items-center gap-2 text-sm">
              <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
              <span className={`font-medium ${text}`}>{summary.text}</span>
            </p>
          </div>
        </div>

        <HealthOverview checks={checks} />

        <HealthHistorySection history={history} nowMs={snapshot.checkedMs} />

        <p className="text-xs text-muted-foreground">
          Read live at {new Date(snapshot.checkedMs).toLocaleTimeString("en-GB")}
          {reported !== null ? `. The server's collector job last reported ${reported === 0 ? "just now" : `${reported} min ago`}.` : "."}
        </p>
      </div>
    </main>
  )
}
