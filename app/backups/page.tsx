import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { BackupMap, JobList } from "@/components/backup-map"
import { verdictStyle } from "@/components/backup-status"
import { getBackups } from "@/lib/backups"

// Same reason as the other routes — this reads live log files on every request
// and must never be frozen into a build-time snapshot.
export const dynamic = "force-dynamic"

export default async function BackupsPage() {
  const snapshot = await getBackups()
  const style = verdictStyle(snapshot.worst)
  const needAttention = snapshot.legs.filter((leg) => leg.verdict !== "ok").length

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col gap-8">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to dashboard
          </Link>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Backups</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                What is protected, and where each copy is kept.
              </p>
            </div>
            <p className="flex items-center gap-2 text-sm">
              <span className={`size-2 rounded-full ${style.dot}`} aria-hidden="true" />
              <span className={`font-medium ${style.text}`}>
                {needAttention === 0
                  ? `All ${snapshot.legs.length} jobs ran on time`
                  : `${needAttention} of ${snapshot.legs.length} jobs need attention`}
              </span>
            </p>
          </div>
        </div>

        <BackupMap legs={snapshot.legs} />
        <JobList legs={snapshot.legs} />

        <p className="text-xs text-muted-foreground">
          Read live from each job&apos;s own log at{" "}
          {new Date(snapshot.checkedMs).toLocaleTimeString("en-GB")}.
        </p>
      </div>
    </main>
  )
}
