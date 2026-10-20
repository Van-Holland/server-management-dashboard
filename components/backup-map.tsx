import { AlertTriangle, Check, ChevronDown, ChevronRight, Cloud, HardDrive, House, Laptop, Server, Shield, X } from "lucide-react"
import type { LucideIcon } from "lucide-react"
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
    inTheHouse: { legId: "time-machine", where: "8TB drive", when: "Daily, at home" },
    outside: null,
    noOutsideCopy: "not outside the house",
  },
  {
    // The rebuild kit. Both copies come from one job (04:30). Rebuild plan step 5/6.
    name: "Mulderserver",
    about: "Everything needed to rebuild the server exactly how it is now on new hardware fully automatic with AI.",
    livesOn: "Server SSD",
    inTheHouse: { legId: "server-config", where: "8TB drive" },
    outside: { legId: "server-config", where: "Proton Drive" },
  },
  {
    name: "Portfolio Performance",
    about: "The encrypted finance files",
    livesOn: "Proton Drive",
    inTheHouse: { legId: "portfolio-mirror", where: "MacBook SSD", when: "When you save" },
    outside: { legId: "vault-to-github", where: "GitHub (private)", when: "Encrypted, every save" },
  },
]

/**
 * Notes shown only in a job's opened row. Wording approved by Matthijs 2026-10-20; it
 * names no counts, so it cannot go stale.
 */
const IF_GONE: Record<string, string[]> = {
  "vault-to-github": ["If Claude is gone: give any AI access to the Second Brain folder and tell it to read README.md."],
  "server-config": [
    "Every night at 04:30 the server packs its app settings, API keys, scripts and job list into one file. One copy goes to the 8TB drive and one to Proton Drive. The last 14 are kept. Movies, music and photos are not in it. They have their own backups.",
    "If the server dies: install Ubuntu on a new machine, give an AI SSH access, and tell it to read REBUILD.md in the Second Brain, folder IT/Projects/Linux Home Server.",
  ],
}

const GRID = "md:grid-cols-[1.25fr_0.85fr_1.15fr_1.15fr]"

/** A small icon for the kind of place a thing lives on. */
function placeIcon(livesOn: string): LucideIcon {
  if (livesOn.includes("MacBook")) return Laptop
  if (livesOn.includes("Proton")) return Cloud
  if (livesOn.includes("SSD")) return Server
  return HardDrive
}

/** A column heading: small uppercase label with an icon, brighter than body text, so it reads as a label. */
function ColumnHead({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-foreground/65">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </span>
  )
}

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

/** What one copy looks like to a reader: missing, just "the originals", or a job's verdict. */
type CopyState =
  | { kind: "none" }
  | { kind: "static" }
  | { kind: "leg"; leg: BackupLeg | undefined; attention: boolean }

function copyState(copy: Copy | null, legs: Map<string, BackupLeg>): CopyState {
  if (copy === null) return { kind: "none" }
  if (copy.legId === undefined) return { kind: "static" }
  const leg = legs.get(copy.legId)
  return { kind: "leg", leg, attention: leg === undefined || leg.verdict !== "ok" }
}

/** The small house or cloud badge on a closed phone row: the icon says which copy, the mark says how it is. */
function CopyPill({ icon: Icon, state, label }: { icon: LucideIcon; state: CopyState; label: string }) {
  if (state.kind === "none") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-usage-high/50 px-2 py-1 text-usage-high"
        role="img"
        aria-label={`${label}: no copy`}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        <X className="size-3" aria-hidden="true" />
      </span>
    )
  }
  const style = verdictStyle(state.kind === "leg" ? (state.leg?.verdict ?? "unknown") : "unknown")
  const bad = state.kind === "leg" && state.attention
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 ${
        bad ? `border-usage-mid/50 ${style.text}` : state.kind === "leg" ? "border-border text-usage-low" : "border-border text-muted-foreground"
      }`}
      role="img"
      aria-label={`${label}: ${state.kind === "leg" ? style.label : "originals live here"}`}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {bad ? <AlertTriangle className="size-3" aria-hidden="true" /> : <Check className="size-3" aria-hidden="true" />}
    </span>
  )
}

/** One copy inside an opened phone row: a line, not a box. */
function CopyLine({
  icon: Icon,
  heading,
  copy,
  legs,
  emptyText,
}: {
  icon: LucideIcon
  heading: string
  copy: Copy | null
  legs: Map<string, BackupLeg>
  emptyText?: string
}) {
  const state = copyState(copy, legs)
  let body: React.ReactNode
  if (copy === null || state.kind === "none") {
    body = (
      <>
        <p className="text-sm text-usage-high">No copy</p>
        {emptyText && <p className="text-xs text-muted-foreground">{emptyText}</p>}
      </>
    )
  } else if (state.kind === "static") {
    body = (
      <>
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="size-2 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
          {copy.where}
        </p>
        <p className="text-xs text-muted-foreground">{copy.note}</p>
      </>
    )
  } else {
    const style = verdictStyle(state.leg?.verdict ?? "unknown")
    const when = copy.when ?? (state.leg ? shortSchedule(state.leg.schedule) : "")
    body = (
      <>
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className={`size-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
          {copy.where}
          {state.attention && <span className={`text-xs font-medium ${style.text}`}>{style.label}</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {when}
          {state.leg && <> · {formatAge(state.leg.ageHours)}</>}
        </p>
      </>
    )
  }
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{heading}</p>
        {body}
      </div>
    </div>
  )
}

/** "Lives on" in an opened phone row, built like the two copy lines below it. */
function LivesOnLine({ livesOn }: { livesOn: string }) {
  const Icon = placeIcon(livesOn)
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Lives on</p>
        <p className="text-sm font-medium text-foreground">{livesOn}</p>
      </div>
    </div>
  )
}

/**
 * The phone version of the map (below the md breakpoint, where the four-column row
 * cannot fit). One slim row per thing with a house badge and a cloud badge, so all
 * seven fit on about one screen and a gap shows as a red crossed badge. Tapping a
 * row opens its details. Native <details>, no client JavaScript. A row whose job is
 * late, overdue or failed starts open; a copy that simply does not exist stays shut,
 * because the red badge already says so.
 */
function PhoneMap({ legs }: { legs: Map<string, BackupLeg> }) {
  return (
    <div>
      <p className="mb-3 flex items-center gap-4 px-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <House className="size-3.5" aria-hidden="true" /> Copy in the house
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Cloud className="size-3.5" aria-hidden="true" /> Copy outside it
        </span>
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {THINGS.map((thing, index) => {
          const house = copyState(thing.inTheHouse, legs)
          const outside = copyState(thing.outside, legs)
          const problem = (house.kind === "leg" && house.attention) || (outside.kind === "leg" && outside.attention)
          return (
            <details key={thing.name} open={problem} className={`group ${index > 0 ? "border-t border-border" : ""}`}>
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 shrink-0 text-muted-foreground group-open:hidden" aria-hidden="true" />
                <ChevronDown className="hidden size-4 shrink-0 text-muted-foreground group-open:block" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{thing.name}</span>
                <CopyPill icon={House} state={house} label="Copy in the house" />
                <CopyPill icon={Cloud} state={outside} label="Copy outside the house" />
              </summary>
              <div className="flex flex-col gap-4 px-3.5 pb-4 pl-10">
                <p className="text-xs text-muted-foreground">{thing.about}</p>
                <LivesOnLine livesOn={thing.livesOn} />
                <CopyLine icon={House} heading="In the house" copy={thing.inTheHouse} legs={legs} emptyText={thing.noHouseCopy} />
                <CopyLine icon={Cloud} heading="Outside the house" copy={thing.outside} legs={legs} emptyText={thing.noOutsideCopy} />
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}

/** The "Lives on" cell on desktop: a tile like the copy tiles beside it. */
function PlaceTile({ livesOn }: { livesOn: string }) {
  const Icon = placeIcon(livesOn)
  return (
    <div className="hidden rounded-xl border border-border bg-card px-3.5 py-3 md:block">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {livesOn}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">Where the original is</p>
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

      <div className="md:hidden">
        <PhoneMap legs={byId} />
      </div>

      <div className={`hidden gap-2 border-b border-border px-1 pb-2.5 md:mb-3 md:grid ${GRID}`}>
        <ColumnHead icon={Shield}>What we protect</ColumnHead>
        <ColumnHead icon={HardDrive}>Lives on</ColumnHead>
        <ColumnHead icon={House}>Copy in the house</ColumnHead>
        <ColumnHead icon={Cloud}>Copy outside the house</ColumnHead>
      </div>

      <div className="hidden flex-col gap-2 md:flex">
        {THINGS.map((thing) => (
          <div
            key={thing.name}
            className={`grid gap-2 max-md:border-b max-md:border-border max-md:pb-5 max-md:last:border-b-0 max-md:last:pb-0 ${GRID}`}
          >
            <div className="rounded-xl border border-border bg-card px-3.5 py-3">
              <p className="text-sm font-medium text-foreground">{thing.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{thing.about}</p>
            </div>
            <PlaceTile livesOn={thing.livesOn} />
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
                {/* The old one-line description of each job is gone: the tiles above already say what is protected. */}
                {IF_GONE[leg.id]?.map((paragraph, i) => (
                  <p key={i} className={`text-foreground/80 ${i > 0 ? "mt-2" : ""}`}>
                    {paragraph}
                  </p>
                ))}
                <dl className={`${IF_GONE[leg.id] ? "mt-3" : ""} grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3`}>
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
