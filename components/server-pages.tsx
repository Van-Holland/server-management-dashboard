import Link from "next/link"
import { ChevronRight, HeartPulse, LayoutGrid } from "lucide-react"
import type { CSSProperties } from "react"
import { formatAge, verdictIcon, verdictStyle } from "@/components/backup-status"
import { formatBytes, type MediaSummary } from "@/lib/media"
import type { BackupsSnapshot } from "@/lib/backups"
import type { HealthSummary } from "@/lib/health-checks"

/**
 * The dashboard's own pages about the server, as three cards under the Server row.
 *
 * Apps are things you USE; these three are things you CHECK: what is on the server,
 * whether it is safe, and whether everything is healthy (Health, added 2026-10-20). That is why they live here and not under "Your apps"
 * (decided 2026-10-19). Each card carries a one-line status, so the Backups card
 * also replaces the wide Backups bar that used to sit on its own row.
 */

const cardClass =
  "panel enter group flex items-center gap-4 rounded-[14px] p-4 transition-colors hover:border-brand/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

function mediaLine(summary: MediaSummary | null): string {
  if (summary === null) return "Browse what is on the server"
  return `${summary.shows} shows, ${summary.films} films, ${formatBytes(summary.bytes)}`
}

/** "MacBook Time Machine: last backup 19h ago" for the worst job, plus a count of the rest. */
function backupsLine(snapshot: BackupsSnapshot): { text: string; tone: string } {
  const problems = snapshot.legs.filter((leg) => leg.verdict !== "ok")
  if (problems.length === 0) {
    return { text: `All ${snapshot.legs.length} backups ran on time`, tone: "text-usage-low" }
  }
  const worst = problems.find((leg) => leg.verdict === snapshot.worst) ?? problems[0]
  const name = worst.name.split(" → ")[0]
  const extra = problems.length > 1 ? ` (+${problems.length - 1} more)` : ""
  return {
    text: `${name}: last backup ${formatAge(worst.ageHours)}${extra}`,
    tone: verdictStyle(snapshot.worst).text,
  }
}

const HEALTH_TONE = {
  ok: "text-usage-low",
  maintenance: "text-usage-mid",
  alert: "text-usage-high",
} as const

export function ServerPages({
  media,
  backups,
  health,
}: {
  media: MediaSummary | null
  backups: BackupsSnapshot
  health: HealthSummary
}) {
  const BackupIcon = verdictIcon(backups.worst)
  const backupStyle = verdictStyle(backups.worst)
  const backupsStatus = backupsLine(backups)

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
      <Link href="/media" className={cardClass} style={{ "--i": 9 } as CSSProperties}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <LayoutGrid className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Media library</p>
          <p className="text-xs text-muted-foreground">{mediaLine(media)}</p>
        </div>
      </Link>

      <Link href="/backups" className={cardClass} style={{ "--i": 10 } as CSSProperties}>
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary ${backupStyle.text}`}>
          <BackupIcon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Backups</p>
          <p className={`text-xs ${backupsStatus.tone}`}>{backupsStatus.text}</p>
        </div>
      </Link>

      <Link href="/health" className={cardClass} style={{ "--i": 11 } as CSSProperties}>
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary ${HEALTH_TONE[health.status]}`}>
          <HeartPulse className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Health</p>
          <p className={`text-xs ${HEALTH_TONE[health.status]}`}>{health.text}</p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </div>
  )
}
