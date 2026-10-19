import { ChevronDown, ChevronRight } from "lucide-react"
import type { BackupLeg } from "@/lib/backups"
import { formatAge, verdictStyle } from "@/components/backup-status"

/**
 * The Backups page as a picture of the system, redesigned 2026-10-19.
 *
 * The old page was seven identical cards in a row: you had to scroll through
 * all of them to learn what is protected and where its copies live. This answers
 * the question a visitor asks first, "is each thing safe, and where is the copy?",
 * one row per thing, with the copy in the house and the copy outside it side by
 * side. A missing copy is drawn as an empty box, because a gap is information.
 *
 * What the data can and cannot say is unchanged: every status here means the job
 * RAN, never that its data can be restored (see lib/backups.ts).
 */

type Copy = {
  /** The job that makes this copy. Absent when the place IS where the thing lives. */
  legId?: string
  /** Where the copy is kept, in plain words. */
  where: string
  /** Overrides the leg's own schedule text when that is a long sentence. */
  when?: string
  /** Shown instead of a schedule for a cell that has no job behind it. */
  note?: string
}

type Thing = {
  name: string
  about: string
  livesOn: string
  inTheHouse: Copy | null
  /** Shown in the empty box, e.g. "only on the server". */
  noHouseCopy?: string
  outside: Copy | null
  noOutsideCopy?: string
}

/**
 * Which job protects which thing. This is a hand-written reading of the seven
 * jobs in lib/backups.ts, so when a job is added or its destination changes,
 * this list has to change with it. Every job appears at least once; the job list
 * below the table is the check that none was left out.
 */
const THINGS: Thing[] = [
  {
    name: "Photos",
    about: "The Immich library",
    // /mnt/storage8tb/photos: the 8TB drive IS where the photos live, so it is also
    // the only copy in the house. Checked against immich's UPLOAD_LOCATION 2026-10-19.
    livesOn: "8TB drive",
    inTheHouse: null,
    noHouseCopy: "only on the 8TB drive",
    outside: { legId: "immich-to-proton", where: "Proton Drive" },
  },
  {
    // The vault is a folder inside Proton Drive, so the Proton-to-8TB job copies it
    // too; GitHub adds the version history. The AI instructions and skills are files
    // in the vault, so they are covered by both.
    name: "Second Brain AI system",
    about: "Vendor-independent: notes, memory, projects, rules and skills for any AI",
    livesOn: "Proton Drive",
    inTheHouse: { legId: "proton-to-hdd", where: "8TB drive" },
    outside: { legId: "vault-to-github", where: "GitHub (private)", when: "Every save, with history" },
  },
  {
    name: "Proton Drive files",
    about: "Documents, scans and everything else kept there",
    livesOn: "Proton Drive",
    inTheHouse: { legId: "proton-to-hdd", where: "8TB drive" },
    // Proton Drive is itself outside the house, so the originals are the outside copy.
    outside: { where: "Proton Drive", note: "the originals live here" },
  },
  {
    name: "Tenant files",
    about: "Van Holland Property Management",
    livesOn: "Server SSD",
    inTheHouse: null,
    noHouseCopy: "only on the server SSD",
    outside: { legId: "vanholland-to-proton", where: "Proton Drive" },
  },
  {
    name: "Fitness data",
    about: "Workouts and weigh-ins",
    livesOn: "Server SSD",
    inTheHouse: { legId: "fitness-to-proton", where: "8TB drive" },
    outside: { legId: "fitness-to-proton", where: "Proton Drive" },
  },
  {
    name: "The MacBook",
    about: "Everything on it, via Time Machine",
    livesOn: "MacBook",
    inTheHouse: { legId: "time-machine", where: "8TB drive", when: "Hourly, at home" },
    outside: null,
    noOutsideCopy: "not outside the house",
  },
  {
    name: "Portfolio Performance",
    about: "The encrypted finance files",
    livesOn: "Proton Drive",
    inTheHouse: { legId: "portfolio-mirror", where: "MacBook SSD", when: "When you save" },
    outside: { legId: "vault-to-github", where: "GitHub (private)", when: "Encrypted, every save" },
  },
]

const GRID = "md:grid-cols-[1.3fr_0.7fr_1.2fr_1.2fr]"

/** "Nightly, 03:00" -> "Nightly 03:00": the comma reads oddly in a small cell. */
function shortSchedule(schedule: string): string {
  return schedule.replace(", ", " ")
}

function CopyCell({
  copy,
  legs,
  heading,
  emptyText,
}: {
  copy: Copy | null
  legs: Map<string, BackupLeg>
  /** Only visible on phones, where the column headers are not. */
  heading: string
  emptyText?: string
}) {
  if (copy === null) {
    return (
      <div className="flex flex-col">
        <p className="mb-1 text-xs text-muted-foreground md:hidden">{heading}</p>
        <div className="flex-1 rounded-xl border border-dashed border-usage-high/40 px-3.5 py-3">
          <p className="text-sm text-usage-high">No copy</p>
          {emptyText && <p className="mt-0.5 text-xs text-muted-foreground">{emptyText}</p>}
        </div>
      </div>
    )
  }

  if (copy.legId === undefined) {
    return (
      <div className="flex flex-col">
        <p className="mb-1 text-xs text-muted-foreground md:hidden">{heading}</p>
        <div className="flex-1 rounded-xl border border-border bg-card px-3.5 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="size-2 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
            {copy.where}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{copy.note}</p>
        </div>
      </div>
    )
  }

  const leg = legs.get(copy.legId)
  const style = verdictStyle(leg?.verdict ?? "unknown")
  const attention = leg !== undefined && leg.verdict !== "ok"
  const when = copy.when ?? (leg ? shortSchedule(leg.schedule) : "")

  return (
    <div className="flex flex-col">
      <p className="mb-1 text-xs text-muted-foreground md:hidden">{heading}</p>
      <div
        className={`flex-1 rounded-xl border bg-card px-3.5 py-3 ${
          attention ? "border-usage-mid/50" : "border-border"
        }`}
      >
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className={`size-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
          {copy.where}
          {attention && <span className={`text-xs font-medium ${style.text}`}>{style.label}</span>}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {when}
          {leg && <> · {formatAge(leg.ageHours)}</>}
        </p>
      </div>
    </div>
  )
}

export function BackupMap({ legs }: { legs: BackupLeg[] }) {
  const byId = new Map(legs.map((leg) => [leg.id, leg]))

  return (
    <section aria-labelledby="map-heading">
      <h2 id="map-heading" className="sr-only">
        What is protected and where its copies are kept
      </h2>

      <div className={`hidden gap-2 px-1 pb-2 text-xs text-muted-foreground md:grid ${GRID}`}>
        <span>What we protect</span>
        <span>Lives on</span>
        <span>Copy in the house</span>
        <span>Copy outside the house</span>
      </div>

      <div className="flex flex-col gap-5 md:gap-2">
        {THINGS.map((thing) => (
          <div
            key={thing.name}
            className={`grid gap-2 max-md:border-b max-md:border-border max-md:pb-5 max-md:last:border-b-0 max-md:last:pb-0 ${GRID}`}
          >
            <div className="rounded-xl border border-border bg-card px-3.5 py-3">
              <p className="text-sm font-medium text-foreground">{thing.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{thing.about}</p>
              <p className="mt-1 text-xs text-muted-foreground md:hidden">Lives on: {thing.livesOn}</p>
            </div>
            <p className="hidden items-center px-1 text-sm text-muted-foreground md:flex">{thing.livesOn}</p>
            <CopyCell copy={thing.inTheHouse} legs={byId} heading="Copy in the house" emptyText={thing.noHouseCopy} />
            <CopyCell copy={thing.outside} legs={byId} heading="Copy outside the house" emptyText={thing.noOutsideCopy} />
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Every job, one line each, closed by default. Native <details>, so no client
 * JavaScript: the row you click opens the detail the old cards showed up front.
 */
export function JobList({ legs }: { legs: BackupLeg[] }) {
  return (
    <section aria-labelledby="jobs-heading">
      <h2 id="jobs-heading" className="mb-2 text-sm font-medium text-muted-foreground">
        All {legs.length} jobs
      </h2>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {legs.map((leg, index) => {
          const style = verdictStyle(leg.verdict)
          return (
            <details key={leg.id} className={`group ${index > 0 ? "border-t border-border" : ""}`}>
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 shrink-0 text-muted-foreground group-open:hidden" aria-hidden="true" />
                <ChevronDown className="hidden size-4 shrink-0 text-muted-foreground group-open:block" aria-hidden="true" />
                <span className={`size-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-foreground">{leg.name}</span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{shortSchedule(leg.schedule)}</span>
                <span className={`w-20 shrink-0 text-right text-xs ${leg.verdict === "ok" ? "text-muted-foreground" : style.text}`}>
                  {formatAge(leg.ageHours)}
                </span>
              </summary>

              <div className="px-4 pb-4 pl-11 text-sm">
                <p className="text-muted-foreground">{leg.protects}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className={`mt-0.5 font-medium ${style.text}`}>{style.label}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Copy is</dt>
                    <dd className="mt-0.5 text-foreground">{leg.offsite ? "Outside the house" : "In the house"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Last result</dt>
                    <dd className="mt-0.5 text-foreground">{leg.detail ?? "—"}</dd>
                  </div>
                </dl>
                <p className="mt-3 break-all font-mono text-[11px] text-muted-foreground">{leg.destination}</p>
                {leg.note && (
                  // Coloured by noteTone, NOT by the verdict: a job can be on time and
                  // still have logged errors, and painting that green hides the problem.
                  <p className={`mt-3 text-xs ${leg.noteTone === "warn" ? "text-usage-mid" : "text-muted-foreground"}`}>
                    {leg.note}
                  </p>
                )}
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )
}
