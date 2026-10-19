import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { formatBytes, getMedia } from "@/lib/media"
import { MediaBrowser } from "@/components/media-browser"
import { HealthBanner } from "@/components/health-banner"
import { getHealthWarnings } from "@/lib/health"
import { RecycleBinButton } from "@/components/recycle-bin-button"
import { getRecycleBin, timeLeft, type RecycleBinSnapshot } from "@/lib/recycle-bin"

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

/**
 * What is currently recoverable, as the content of the Recycle bin dialog.
 *
 * Read-only, and no restore control on purpose: putting a file back also needs
 * a Sonarr rescan and the episode re-monitored, and a half-done restore looks
 * exactly like a finished one. How the bin works is written down in the vault
 * ("Media Upgrade System"), not on this page.
 */
function RecycleBinTable({ bin, nowMs }: { bin: RecycleBinSnapshot; nowMs: number }) {
  return (
    <>
      <p className="mt-1 text-xs text-muted-foreground">
        {bin.fileCount > 0 && <>{formatBytes(bin.totalBytes)} · </>}
        {bin.retentionDays === null
          ? "retention unknown"
          : bin.retentionDays === 1
            ? // The cleanup runs once every 24h, so a 1-day setting really means
              // "at the first sweep after 24h", i.e. 24 to 48 hours.
              "kept 1–2 days, then deleted automatically"
            : `kept ${bin.retentionDays} days, then deleted automatically`}
      </p>

      <div className="mt-4">
        {bin.error ? (
          <p className="text-xs text-usage-high">{bin.error}</p>
        ) : bin.groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">Empty. Nothing deleted recently is still recoverable.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left">
              <thead>
                <tr className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-1 pr-3 font-medium">What</th>
                  <th className="pb-1 pr-3 text-right font-medium">Files</th>
                  <th className="pb-1 pr-3 text-right font-medium">Size</th>
                  <th className="pb-1 pr-3 font-medium">Deleted</th>
                  <th className="pb-1 text-right font-medium">Gone</th>
                </tr>
              </thead>
              <tbody>
                {bin.groups.map((g) => {
                  // Under a day left is worth flagging: the cleanup runs once
                  // daily, so "tomorrow" is the last chance, not a warning shot.
                  const urgent = g.firstGoesMs !== 0 && g.firstGoesMs - nowMs < 86_400_000
                  return (
                    <tr key={g.name} className="border-t border-border/60">
                      <td className="py-2 pr-3 text-xs text-foreground">{g.name}</td>
                      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {g.fileCount}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {formatBytes(g.totalBytes)}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">{clock(g.addedMs)}</td>
                      <td className="py-2 text-right text-xs">
                        <span className={urgent ? "font-semibold text-usage-high" : "text-muted-foreground"}>
                          {timeLeft(g.firstGoesMs, nowMs)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

export default async function MediaPage() {
  const [snapshot, bin, warnings] = await Promise.all([getMedia(), getRecycleBin(), getHealthWarnings()])

  const seriesCount = snapshot.groups.filter((g) => g.kind === "series").length
  const movieCount = snapshot.groups.filter((g) => g.kind === "movie").length
  const totalBytes = snapshot.groups.reduce((n, g) => n + g.totalBytes, 0)

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col gap-6">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to dashboard
          </Link>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Media</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {seriesCount} shows · {movieCount} films · {formatBytes(totalBytes)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {/* Quiet while the nightly upgrade sweep is healthy; red only when
                  it has gone quiet, which is the one thing worth noticing. */}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={`size-2 rounded-full ${snapshot.sweepStale ? "bg-usage-high" : "bg-usage-low"}`}
                  aria-hidden="true"
                />
                {snapshot.sweepStale ? (
                  <span className="font-medium text-usage-high">
                    Nightly sweep overdue · last ran {timeAgo(snapshot.lastRunMs)}
                  </span>
                ) : (
                  <>Nightly sweep ran {timeAgo(snapshot.lastRunMs)}</>
                )}
              </p>
              <RecycleBinButton count={bin.groups.length}>
                <RecycleBinTable bin={bin} nowMs={snapshot.checkedMs} />
              </RecycleBinButton>
            </div>
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

        {/* A title that never arrives is usually this, so it sits above the grid. */}
        <HealthBanner warnings={warnings} />

        <MediaBrowser groups={snapshot.groups} />
      </div>
    </main>
  )
}
