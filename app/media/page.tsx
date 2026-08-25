import { Fragment, type ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft, ChevronDown, ChevronRight, Clock, Film, Gauge, Tv } from "lucide-react"
import {
  formatBytes,
  formatMbps,
  formatRuntime,
  getMedia,
  type MediaFile,
  type MediaGroup,
  type UpgradeRules,
} from "@/lib/media"
import { DeleteMediaButton } from "@/components/delete-media-button"

/** Columns in the file table, so the season header's colSpan cannot drift out
 *  of step with the header row above it. */
const DATA_COLUMNS = 7

/** Season 0 is where Sonarr files specials, and "Season 0" reads like a bug. */
function seasonLabel(n: number): string {
  return n === 0 ? "Specials" : `Season ${n}`
}

// Reads live API state and files on every request — must never be frozen into
// a build-time snapshot. Same reason as the other routes.
export const dynamic = "force-dynamic"

function timeAgo(ms: number | null): string {
  if (ms === null) return "never"
  const mins = Math.round((Date.now() - ms) / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function clock(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function FileRow({ file, action }: { file: MediaFile; action: ReactNode }) {
  return (
    <tr className="border-t border-border/60">
      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">{file.label}</td>
      <td className="py-2 pr-3 text-xs text-foreground">
        {file.quality}
        {file.codec && <span className="ml-1.5 text-muted-foreground">{file.codec}</span>}
      </td>
      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {formatBytes(file.sizeBytes)}
      </td>
      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">
        <span className={file.thin ? "font-semibold text-usage-high" : "text-foreground"}>
          {formatMbps(file.bitrateBps)}
        </span>
      </td>
      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {formatRuntime(file.runtimeSec)}
      </td>
      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">
        <span className={file.customFormatScore < 0 ? "text-usage-high" : "text-muted-foreground"}>
          {file.customFormatScore}
        </span>
      </td>
      <td className="py-2 pr-3 text-right text-xs">
        {file.wantsUpgrade ? (
          <span className="text-muted-foreground">
            {file.lane === "slow" ? "monthly" : "every 4d"}
            {file.attempts !== null && file.attempts > 0 && (
              <span className="ml-1 opacity-60">· {file.attempts} tried</span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground opacity-50">done</span>
        )}
      </td>
      <td className="py-1 text-right">{action}</td>
    </tr>
  )
}

/** The line that has to stand alone while a group is collapsed. Everything worth
 *  reacting to — missing episodes, thin files — is repeated here, because a
 *  warning you have to click to discover is a warning nobody sees. */
function GroupSummary({ group, thin }: { group: MediaGroup; thin: number }) {
  const Icon = group.kind === "series" ? Tv : Film
  const wantsUpgrade = group.files.filter((f) => f.wantsUpgrade).length

  /*
   * A one-file group (a film) is collapsible like everything else, but folding
   * it away must not hide the two numbers this page exists to show. So for a
   * single file the summary carries its quality and bitrate outright — collapsed
   * costs you the runtime and score columns, nothing that matters at a glance.
   */
  const only = group.files.length === 1 ? group.files[0] : null

  return (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{group.title}</p>
        <p className="text-xs text-muted-foreground">
          {only ? (
            <>
              {only.quality} · {formatBytes(only.sizeBytes)} ·{" "}
              <span className={only.thin ? "font-semibold text-usage-high" : "text-foreground"}>
                {formatMbps(only.bitrateBps)}
              </span>
              {only.wantsUpgrade && <> · still hunting</>}
            </>
          ) : (
            <>
              {group.files.length} file{group.files.length === 1 ? "" : "s"}
              {group.totalBytes > 0 && <> · {formatBytes(group.totalBytes)}</>}
              {wantsUpgrade > 0 && <> · {wantsUpgrade} still hunting</>}
              {thin > 0 && <span className="text-usage-high"> · {thin} thin</span>}
            </>
          )}
          {/* Always separated — both branches above always render something,
              so an unconditional separator cannot produce a leading "· ". */}
          {group.missingCount > 0 && (
            <span className="text-usage-high"> · {group.missingCount} missing</span>
          )}
        </p>
      </div>
    </>
  )
}

/**
 * Episodes are grouped under a season header, which is new as of the delete
 * feature and not merely decorative: "delete this season" needs somewhere to
 * live, and a flat list of 20 episodes has no such place. Films skip all of
 * this — a one-file group needs no grouping, and its delete lives on the group
 * header where it removes the film outright.
 */
function FileTable({ group }: { group: MediaGroup }) {
  const bySeason = new Map<number, MediaFile[]>()
  for (const f of group.files) {
    // Files arrive sorted by label ("S01E01"…), so insertion order here is
    // already season order and no second sort is needed.
    const n = f.seasonNumber ?? -1
    const bucket = bySeason.get(n)
    if (bucket) bucket.push(f)
    else bySeason.set(n, [f])
  }

  return (
    <div className="overflow-x-auto px-5 pb-4">
      <table className="w-full min-w-[40rem] text-left">
        <thead>
          <tr className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
            <th className="pb-1 pr-3 font-medium">Item</th>
            <th className="pb-1 pr-3 font-medium">Quality</th>
            <th className="pb-1 pr-3 text-right font-medium">Size</th>
            <th className="pb-1 pr-3 text-right font-medium">Bitrate</th>
            <th className="pb-1 pr-3 text-right font-medium">Runtime</th>
            <th className="pb-1 pr-3 text-right font-medium">Score</th>
            <th className="pb-1 pr-3 text-right font-medium">Rechecked</th>
            <th className="pb-1 text-right font-medium">
              <span className="sr-only">Delete</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {group.kind === "movie"
            ? group.files.map((f) => <FileRow key={f.key} file={f} action={null} />)
            : [...bySeason.entries()].map(([seasonNumber, files]) => (
                <Fragment key={seasonNumber}>
                  <tr className="border-t border-border/60 bg-secondary/20">
                    <td colSpan={DATA_COLUMNS} className="py-1.5 pr-3 text-xs font-medium text-foreground">
                      {seasonLabel(seasonNumber)}
                      {/* A real separator, not just a margin: without it the
                          text content reads "Season 16 files" to a screen
                          reader and to anyone copying the row. */}
                      <span className="ml-2 font-normal text-muted-foreground">
                        · {files.length} file{files.length === 1 ? "" : "s"} ·{" "}
                        {formatBytes(files.reduce((n, f) => n + f.sizeBytes, 0))}
                      </span>
                    </td>
                    <td className="py-1 text-right">
                      <DeleteMediaButton
                        size="sm"
                        target={{ kind: "season", id: group.arrId, seasonNumber }}
                        title={`${group.title} — ${seasonLabel(seasonNumber)}`}
                        detail={`${files.length} file${files.length === 1 ? "" : "s"} · ${formatBytes(
                          files.reduce((n, f) => n + f.sizeBytes, 0),
                        )}`}
                        removesEntry={false}
                      />
                    </td>
                  </tr>
                  {files.map((f) => (
                    <FileRow
                      key={f.key}
                      file={f}
                      action={
                        // Both ids are required by the API route, so a row that
                        // somehow lacks either gets no button rather than a
                        // button that fails when pressed.
                        f.episodeId !== null && f.episodeFileId !== null ? (
                          <DeleteMediaButton
                            size="sm"
                            target={{
                              kind: "episode",
                              id: group.arrId,
                              episodeId: f.episodeId,
                              episodeFileId: f.episodeFileId,
                            }}
                            title={`${group.title} — ${f.label}`}
                            detail={`${f.quality} · ${formatBytes(f.sizeBytes)}`}
                            removesEntry={false}
                          />
                        ) : null
                      }
                    />
                  ))}
                </Fragment>
              ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Every group with files collapses — series and films alike.
 *
 * A group with NO files (a monitored show or film nothing has downloaded yet)
 * renders as a plain block instead: making it a <details> would give it a
 * disclosure control that opens onto nothing, which reads as broken.
 *
 * Built on <details>/<summary> rather than React state on purpose: it needs no
 * client JavaScript, so this page stays a server component, and the browser
 * gives keyboard support and correct toggle-on-second-click for free.
 */
function GroupBlock({ group }: { group: MediaGroup }) {
  const thin = group.files.filter((f) => f.thin).length

  /*
   * The group-level delete is the only one that removes the ENTRY rather than
   * just files: the film or show leaves Radarr/Sonarr and its Jellyseerr record
   * is cleared. That is why `removesEntry` is true here and false everywhere
   * else — the dialog says something materially different in each case.
   */
  const removeEntry = (
    <DeleteMediaButton
      target={
        group.kind === "movie"
          ? { kind: "movie", id: group.arrId }
          : { kind: "series", id: group.arrId }
      }
      title={group.title}
      detail={
        group.files.length === 0
          ? "Nothing on disk — this removes the entry only"
          : `${group.files.length} file${group.files.length === 1 ? "" : "s"} · ${formatBytes(group.totalBytes)}`
      }
      removesEntry
    />
  )

  if (group.files.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4">
          <GroupSummary group={group} thin={thin} />
          {removeEntry}
        </div>
      </div>
    )
  }

  return (
    <details className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-x-4 gap-y-1 rounded-xl px-5 py-4 transition-colors hover:bg-secondary/30 [&::-webkit-details-marker]:hidden">
        <GroupSummary group={group} thin={thin} />
        {/*
          Two icons swapped by display, rather than one icon rotated.
          `rotate-90` does not take in this project — verified in the browser:
          even the plain utility computes to `rotate: 0deg` on an element the
          rule demonstrably matches, so something else in the CSS is winning.
          That is worth chasing separately; it is not worth blocking a
          disclosure arrow on. `hidden`/`block` under the same `group-open:`
          variant work, and the variant itself was confirmed matching.
        */}
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground group-open:hidden"
          aria-hidden="true"
        />
        <ChevronDown
          className="hidden size-4 shrink-0 text-muted-foreground group-open:block"
          aria-hidden="true"
        />
        {/* Inside the <summary>, so the button itself must stop the click from
            toggling the disclosure — handled in DeleteMediaButton. */}
        {removeEntry}
      </summary>
      <FileTable group={group} />
    </details>
  )
}

function RulesBlock({ rules }: { rules: UpgradeRules }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{rules.app}</p>
        <p className="font-mono text-xs text-muted-foreground">{rules.profileName}</p>
      </div>
      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Stops looking at</dt>
          <dd className="font-mono text-foreground">{rules.cutoffName}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Minimum score to grab</dt>
          <dd className="font-mono text-foreground">{rules.minFormatScore}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Still wants better</dt>
          <dd className="font-mono text-foreground">{rules.cutoffUnmetTotal} items</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Checked per night</dt>
          <dd className="font-mono text-foreground">max {rules.nightlyBatch}</dd>
        </div>
      </dl>
      {rules.formats.length > 0 ? (
        <div className="mt-3 border-t border-border/60 pt-3">
          <p className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">Scoring rules</p>
          <ul className="mt-1.5 space-y-1">
            {rules.formats.map((f) => (
              <li key={f.name} className="flex justify-between gap-3 text-xs">
                <span className="text-foreground">{f.name}</span>
                <span className={`font-mono ${f.score < 0 ? "text-usage-high" : "text-foreground"}`}>
                  {f.score > 0 ? `+${f.score}` : f.score}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 border-t border-border/60 pt-3 text-xs text-usage-high">
          No scoring rules — every same-quality release ties, so nothing can ever upgrade.
        </p>
      )}
    </div>
  )
}

export default async function MediaPage() {
  const snapshot = await getMedia()

  const series = snapshot.groups.filter((g) => g.kind === "series")
  const movies = snapshot.groups.filter((g) => g.kind === "movie")
  const totalBytes = snapshot.groups.reduce((n, g) => n + g.totalBytes, 0)
  const totalFiles = snapshot.groups.reduce((n, g) => n + g.files.length, 0)
  const thinTotal = snapshot.groups.reduce((n, g) => n + g.files.filter((f) => f.thin).length, 0)

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
          <h1 className="mt-4 text-2xl font-semibold text-foreground">Media</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Everything on the 8TB drive, what quality it actually is, and when the upgrade sweep
            looks again. {totalFiles} files · {formatBytes(totalBytes)}
            {thinTotal > 0 && (
              <>
                {" "}
                · {thinTotal} {thinTotal === 1 ? "looks" : "look"} thin for their resolution
              </>
            )}
            .
          </p>
        </div>

        {/*
          Stated permanently, not as a dismissible hint. The reason this page
          exists is that a quality LABEL hid a bad file for three weeks: "WEBDL-
          1080p" was shown for both a 599 MB copy and a 2413 MB one, and Sonarr
          scored them as a tie. Bitrate is the column that would have caught it,
          so the page says so rather than assuming anyone remembers.
        */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
              <Gauge className="size-4" aria-hidden="true" />
            </span>
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Read the bitrate, not the label.</span>{" "}
              Two files can both say &ldquo;WEBDL-1080p&rdquo; and differ fourfold in size — that is
              exactly how a 1.86 Mbps copy of The Hardacres went unnoticed for three weeks. Bitrate
              here is the whole file, computed as size ÷ runtime. &ldquo;Thin&rdquo; is a rough
              guide by resolution, not a verdict: a good encode can sit below it.
            </p>
          </div>
        </div>

        {snapshot.errors.length > 0 && (
          <div className="rounded-xl border border-usage-high/40 bg-card p-5">
            <p className="text-sm font-medium text-usage-high">Some data could not be read</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Anything below is missing from this page, not merely unusual — treat the numbers as
              incomplete.
            </p>
            <ul className="mt-2 space-y-1">
              {snapshot.errors.map((e) => (
                <li key={e} className="font-mono text-xs text-muted-foreground">
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/*
          Notes are NOT errors and must not borrow their styling. "Shows span 2
          profiles" is a fact worth knowing, not a failure; rendering it under a
          red "could not be read" heading trains you to ignore that heading,
          which is the one thing here that has to stay believable.
        */}
        {snapshot.notes.length > 0 && (
          <ul className="space-y-1">
            {snapshot.notes.map((n) => (
              <li key={n} className="text-xs text-muted-foreground">
                {n}
              </li>
            ))}
          </ul>
        )}

        <section>
          <h2 className="text-sm font-medium text-foreground">The rules, as the apps report them now</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Read live from Sonarr and Radarr on every page load — never typed in here, so it cannot
            drift away from what is actually configured.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {snapshot.rules.map((r) => (
              <RulesBlock key={r.app} rules={r} />
            ))}
          </div>
        </section>

        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-sm font-medium text-foreground">The nightly sweep</h2>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" aria-hidden="true" />
              next {clock(snapshot.nextRunMs)}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Last run {timeAgo(snapshot.lastRunMs)}
            {snapshot.sweepStale && (
              <span className="ml-1.5 font-medium text-usage-high">
                — overdue, a daily job should never be this old
              </span>
            )}
            .
          </p>

          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card p-5">
            {snapshot.history.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No runs recorded yet in upgrade-history.jsonl.
              </p>
            ) : (
              <table className="w-full min-w-[32rem] text-left">
                <thead>
                  <tr className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-1 pr-3 font-medium">When</th>
                    <th className="pb-1 pr-3 font-medium">App</th>
                    <th className="pb-1 pr-3 text-right font-medium">On list</th>
                    <th className="pb-1 pr-3 text-right font-medium">Searched</th>
                    <th className="pb-1 text-right font-medium">Resolved</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.history.map((run, i) => (
                    <tr key={`${run.tsMs}-${run.app}-${i}`} className="border-t border-border/60">
                      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                        {clock(run.tsMs)}
                      </td>
                      <td className="py-2 pr-3 text-xs capitalize text-foreground">{run.app}</td>
                      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {run.cutoffTotal}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums text-foreground">
                        {run.checked.length}
                        {run.error && <span className="ml-1.5 text-usage-high">{run.error}</span>}
                      </td>
                      <td className="py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {run.resolved}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-foreground">TV</h2>
          <div className="mt-3 flex flex-col gap-4">
            {series.map((g) => (
              <GroupBlock key={g.id} group={g} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-foreground">Films</h2>
          <div className="mt-3 flex flex-col gap-4">
            {movies.map((g) => (
              <GroupBlock key={g.id} group={g} />
            ))}
          </div>
        </section>

        <p className="text-xs text-muted-foreground">
          No grab or search buttons — starting downloads by accident is what the nightly sweep&rsquo;s
          batch cap exists to prevent. Deleting is available and always switches monitoring off too,
          so nothing re-downloads overnight; files keep for 7 days in{" "}
          <span className="font-mono">/downloads/.recyclebin</span>. Checked{" "}
          {clock(snapshot.checkedMs)}.
        </p>
      </div>
    </main>
  )
}
