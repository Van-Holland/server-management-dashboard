import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { BackupLeg, BackupVerdict, BackupsSnapshot } from "@/lib/backups"
import { RESTORE_TEST_MAX_AGE_MS } from "@/lib/backups"

/**
 * Presentation for backup verdicts. Reuses the same usage-low/mid/high tokens
 * as the disk and CPU bars so "green means fine" carries the same meaning
 * everywhere on the dashboard rather than being re-invented per card.
 */
const PRESENTATION: Record<BackupVerdict, { label: string; text: string; dot: string }> = {
  ok: { label: "OK", text: "text-usage-low", dot: "bg-usage-low" },
  late: { label: "Late", text: "text-usage-mid", dot: "bg-usage-mid" },
  overdue: { label: "Overdue", text: "text-usage-high", dot: "bg-usage-high" },
  failed: { label: "Failed", text: "text-usage-high", dot: "bg-usage-high" },
  // Grey, not green. An unreadable log is not a passing backup, and colouring
  // it green would recreate the exact failure this page exists to catch.
  unknown: { label: "Unknown", text: "text-muted-foreground", dot: "bg-muted-foreground" },
}

const ICONS: Record<BackupVerdict, LucideIcon> = {
  ok: ShieldCheck,
  late: ShieldAlert,
  overdue: ShieldAlert,
  failed: ShieldAlert,
  unknown: ShieldQuestion,
}

export function verdictStyle(verdict: BackupVerdict) {
  return PRESENTATION[verdict]
}

export function formatAge(hours: number | null): string {
  if (hours === null) return "never"
  if (hours < 1) return "just now"
  if (hours < 24) return `${Math.floor(hours)}h ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

/**
 * The badge text for the restore gap, or null when a restore is recent enough
 * to still mean something. Returns a string rather than a boolean so the stale
 * case can say how stale — "never tested" and "tested 8 months ago" are
 * different problems and deserve different words.
 *
 * Silence here is earned and expires. Lesson 07: the absence of a restore test
 * has to raise the alarm by itself, because nothing else is going to.
 */
export function restoreWarning(testedMs: number | null, now: number = Date.now()): string | null {
  if (testedMs === null) return "Restore never tested"
  const ageMs = now - testedMs
  if (ageMs <= RESTORE_TEST_MAX_AGE_MS) return null
  const months = Math.floor(ageMs / (30 * 24 * 60 * 60 * 1000))
  return `Restore test ${months} months old`
}

/**
 * The home-page tile. Deliberately shows the WORST leg rather than an average
 * or a count of healthy ones — four green jobs do not offset one that has been
 * silently dead for a week.
 */
export function BackupCard({ snapshot }: { snapshot: BackupsSnapshot }) {
  const style = PRESENTATION[snapshot.worst]
  const Icon = ICONS[snapshot.worst]
  const problems = snapshot.legs.filter((leg) => leg.verdict !== "ok")

  const oldest = snapshot.legs
    .filter((leg) => leg.ageHours !== null)
    .sort((a, b) => (b.ageHours ?? 0) - (a.ageHours ?? 0))[0]

  return (
    <a
      href="/backups"
      className="group flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl border border-border bg-card p-5 transition-colors hover:bg-secondary/40 sm:p-6"
    >
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary ${style.text}`}>
        <Icon className="size-5" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-medium text-foreground">Backups</p>
          <span className={`text-sm font-semibold ${style.text}`}>{style.label}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {problems.length > 0
            ? `${problems.length} of ${snapshot.legs.length} need attention — ${problems
                .map((p) => p.name.split(" → ")[0])
                .join(", ")}`
            : oldest
              ? `All ${snapshot.legs.length} jobs healthy · oldest ${oldest.name.split(" → ")[0]}, ${formatAge(oldest.ageHours)}`
              : "No jobs reporting"}
        </p>
      </div>

      {restoreWarning(snapshot.restoreTestedMs) && (
        // Shown even when every leg is green, because this is the gap that
        // turns any of the others from an inconvenience into a real loss.
        <span className="shrink-0 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-medium text-usage-mid">
          {restoreWarning(snapshot.restoreTestedMs)}
        </span>
      )}

      <span className="shrink-0 text-xs text-muted-foreground group-hover:text-foreground">
        View all →
      </span>
    </a>
  )
}

export function LegRow({ leg }: { leg: BackupLeg }) {
  const style = PRESENTATION[leg.verdict]

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{leg.name}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{leg.protects}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`size-2 rounded-full ${style.dot}`} aria-hidden="true" />
          <span className={`text-sm font-medium ${style.text}`}>{style.label}</span>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Last run</dt>
          <dd className="mt-0.5 text-foreground">{formatAge(leg.ageHours)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Schedule</dt>
          <dd className="mt-0.5 text-foreground">{leg.schedule}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Copy is</dt>
          <dd className="mt-0.5 text-foreground">{leg.offsite ? "Offsite" : "In the house"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Result</dt>
          <dd className="mt-0.5 text-foreground">{leg.detail ?? "—"}</dd>
        </div>
      </dl>

      <p className="mt-3 break-all font-mono text-[11px] text-muted-foreground">{leg.destination}</p>

      {leg.note && (
        // Coloured by noteTone, NOT by the verdict. A job can be "ok" on timing
        // and still have logged errors, and painting that warning green is the
        // precise failure this page exists to catch.
        <p
          className={`mt-3 border-t border-border pt-3 text-xs ${
            leg.noteTone === "warn" ? "text-usage-mid" : "text-muted-foreground"
          }`}
        >
          {leg.note}
        </p>
      )}
    </div>
  )
}
