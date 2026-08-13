import Link from "next/link"
import { ArrowLeft, ShieldAlert } from "lucide-react"
import { LegRow, verdictStyle } from "@/components/backup-status"
import { getBackups } from "@/lib/backups"

// Same reason as the other routes — this reads live log files on every request
// and must never be frozen into a build-time snapshot.
export const dynamic = "force-dynamic"

export default async function BackupsPage() {
  const snapshot = await getBackups()
  const style = verdictStyle(snapshot.worst)

  const offsite = snapshot.legs.filter((leg) => leg.offsite).length

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
          <h1 className="mt-4 text-2xl font-semibold text-foreground">Backups</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every backup job, and when it last actually ran. Overall status:{" "}
            <span className={`font-medium ${style.text}`}>{style.label}</span>.
          </p>
        </div>

        {/*
          Stated plainly and permanently, not as a dismissible warning. This
          page can only ever prove that a job RAN — never that what it wrote
          can be restored. Leaving that unsaid would let a wall of green imply
          a guarantee none of these checks actually make.
        */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-usage-mid" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-foreground">What this page does and does not tell you</p>
              <p className="mt-1.5 text-muted-foreground">
                Green means the job ran and finished. It does <strong>not</strong> mean the data it
                wrote can be restored — only an actual restore proves that, and one has never been
                performed. It is also a page you have to remember to open; it will not come and
                find you.
              </p>
            </div>
          </div>
        </div>

        <section className="flex flex-col gap-4">
          {snapshot.legs.map((leg) => (
            <LegRow key={leg.id} leg={leg} />
          ))}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-medium text-foreground">How the copies fit together</h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">{offsite} of {snapshot.legs.length}</strong> jobs
              put a copy outside the house. The rest land on the 8TB drive, which sits next to the
              server — fine for a dead disk, no help for fire or theft.
            </li>
            <li>
              The 8TB copy of Proton Drive is <strong className="text-foreground">downstream</strong>{" "}
              of Proton, not independent of it. Anything that never reaches Proton never reaches the
              8TB drive either.
            </li>
            <li>
              Only the vault has real <strong className="text-foreground">version history</strong>,
              via git — including the encrypted Portfolio Performance files since 2026-08-13.
              Everything else keeps overwrite history through rclone&apos;s dated versions folders.
            </li>
          </ul>
        </section>

        <p className="text-xs text-muted-foreground">
          Read live from each job&apos;s own log at{" "}
          {new Date(snapshot.checkedMs).toLocaleTimeString("en-GB")}.
        </p>
      </div>
    </main>
  )
}
