import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { BackupLeg, BackupVerdict, BackupsSnapshot } from "@/lib/backups"

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

      <span className="shrink-0 text-xs text-muted-foreground group-hover:text-foreground">
        View all →
      </span>
    </a>
  )
}
