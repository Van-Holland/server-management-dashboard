import Link from "next/link"
import { ArrowLeft, Clock, Film, Gauge, Tv } from "lucide-react"
import {
  formatBytes,
  formatMbps,
  formatRuntime,
  getMedia,
  type MediaFile,
  type MediaGroup,
  type UpgradeRules,
} from "@/lib/media"

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

function FileRow({ file }: { file: MediaFile }) {
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
      <td className="py-2 text-right text-xs">
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
    </tr>
  )
}

function GroupBlock({ group }: { group: MediaGroup }) {
  const Icon = group.kind === "series" ? Tv : Film
  const thin = group.files.filter((f) => f.thin).length

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{group.title}</p>
            <p className="text-xs text-muted-foreground">
              {group.files.length} file{group.files.length === 1 ? "" : "s"}
              {group.totalBytes > 0 && <> · {formatBytes(group.totalBytes)}</>}
              {group.missingCount > 0 && (
                <span className="text-usage-high"> · {group.missingCount} missing</span>
              )}
              {thin > 0 && <span className="text-usage-high"> · {thin} thin</span>}
            </p>
          </div>
        </div>
      </div>

      {group.files.length > 0 && (
        <div className="overflow-x-auto px-5 pb-4">
          <table className="w-full min-w-[38rem] text-left">
            <thead>
              <tr className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                <th className="pb-1 pr-3 font-medium">Item</th>
                <th className="pb-1 pr-3 font-medium">Quality</th>
                <th className="pb-1 pr-3 text-right font-medium">Size</th>
                <th className="pb-1 pr-3 text-right font-medium">Bitrate</th>
                <th className="pb-1 pr-3 text-right font-medium">Runtime</th>
                <th className="pb-1 pr-3 text-right font-medium">Score</th>
                <th className="pb-1 text-right font-medium">Rechecked</th>
              </tr>
            </thead>
            <tbody>
              {group.files.map((f) => (
                <FileRow key={f.key} file={f} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
          Read-only by design — no grab, delete, or search buttons. Checked {clock(snapshot.checkedMs)}.
        </p>
      </div>
    </main>
  )
}
