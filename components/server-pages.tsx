import Link from "next/link"
import { ArrowRight, LayoutGrid } from "lucide-react"
import { formatAge, verdictIcon, verdictStyle } from "@/components/backup-status"
import { formatBytes, type MediaSummary } from "@/lib/media"
import type { BackupsSnapshot } from "@/lib/backups"

/**
 * The dashboard's own pages about the server, as two cards under the Server row.
 *
 * Apps are things you USE; these two are things you CHECK: what is on the server,
 * and whether it is safe. That is why they live here and not under "Your apps"
 * (decided 2026-10-19). Each card carries a one-line status, so the Backups card
 * also replaces the wide Backups bar that used to sit on its own row.
 */

const cardClass =
  "group flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

function mediaLine(summary: MediaSummary | null): string {
  if (summary === null) return "Browse what is on the server"
  return `${summary.shows} shows · ${summary.films} films · ${formatBytes(summary.bytes)}`
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

export function ServerPages({ media, backups }: { media: MediaSummary | null; backups: BackupsSnapshot }) {
  const BackupIcon = verdictIcon(backups.worst)
  const backupStyle = verdictStyle(backups.worst)
  const backupsStatus = backupsLine(backups)

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
      <Link href="/media" className={cardClass}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <LayoutGrid className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Media library</p>
          <p className="text-xs text-muted-foreground sm:truncate">{mediaLine(media)}</p>
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden="true" />
      </Link>

      <Link href="/backups" className={cardClass}>
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary ${backupStyle.text}`}>
          <BackupIcon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Backups</p>
          <p className={`text-xs sm:truncate ${backupsStatus.tone}`}>{backupsStatus.text}</p>
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden="true" />
      </Link>
    </div>
  )
}
