/**
 * Deleting media — and why every delete here is at least two operations.
 *
 * The obvious mistake this module exists to avoid: deleting a file while the
 * app still WANTS that file. Sonarr's RSS sync runs every 15 minutes and
 * `search-missing.sh` runs at 23:00 specifically to find monitored items with
 * no file and go fetch them. Delete an episode at 20:00 without unmonitoring
 * it and it is back before midnight, having spent indexer budget to return.
 *
 * So: **stop wanting it, THEN delete the file.** Never one without the other,
 * and never in the other order — see the note above the four operations for
 * what that cost on the first real delete.
 *
 * Safety, verified live on 2026-08-25 rather than assumed: both Sonarr and
 * Radarr have a recycle bin configured at `/downloads/.recyclebin` with
 * `recycleBinCleanupDays: 7`. Because every delete below goes THROUGH the arr
 * apps rather than touching the filesystem directly, deleted files land there
 * and stay recoverable for a week. A delete route that unlinked files itself
 * would lose that, which is the main reason this module never touches disk.
 *
 * Jellyfin needs no call from us. Both apps already have the Emby/Jellyfin
 * connection wired with `onSeriesDelete`, `onEpisodeFileDelete`,
 * `onMovieDelete` and `onMovieFileDelete` all enabled — they notify Jellyfin
 * themselves, per file, which is more targeted than anything triggerable from
 * here. Confirmed against the live `/api/v3/notification` on both apps.
 */

/**
 * Two timeouts, because two very different things happen here.
 *
 * Reading metadata and flipping a monitored flag are sub-second calls.
 * Deleting is not: Sonarr mounts `/downloads` and `/tv` as SEPARATE bind
 * mounts, so although both sit on the same host filesystem (/dev/sda1), a
 * rename between them inside the container fails with EXDEV and Sonarr falls
 * back to **copy-then-delete** at roughly 58 MB/s. A 22 GB season therefore
 * takes six to eight minutes of real copying.
 *
 * This was measured the hard way on 2026-08-25: a 30s timeout on a 10-episode
 * Landman season aborted the HTTP request while Sonarr carried on working in
 * the background — the client gave up, the server did not. Note the vault's
 * claim that the recycle bin is "same filesystem so moves are instant" is true
 * of the host and false of the only place it matters, inside the container.
 */
const META_TIMEOUT_MS = 15_000
const DELETE_TIMEOUT_MS = 600_000

/**
 * What the UI can ask to remove.
 *
 * Note the asymmetry, which is not an oversight: a movie or a series is
 * removed ENTIRELY (gone from Radarr/Sonarr, Jellyseerr record cleared), while
 * a season or an episode can only ever have its files removed and its
 * monitoring switched off. That is not a product decision — Sonarr has no
 * concept of "a season that is not part of a series", so there is nothing else
 * to delete at those levels.
 */
export type DeleteTarget =
  | { kind: "movie"; id: number }
  | { kind: "series"; id: number }
  | { kind: "season"; id: number; seasonNumber: number }
  | { kind: "episode"; id: number; episodeId: number; episodeFileId: number }

/**
 * One line per thing attempted. Steps are reported individually and never
 * collapsed into a single boolean, because partial success is the normal
 * outcome worth seeing: files can delete cleanly while the Jellyseerr cleanup
 * finds no matching record, and calling that whole operation "failed" would be
 * both wrong and alarming.
 */
export type DeleteStep = {
  step: string
  /**
   * "running" is not a failure. A large season genuinely takes minutes to copy
   * into the recycle bin, and aborting the HTTP request does not stop the arr
   * app — so the honest report is "still going", and crucially NOT something
   * that invites the user to press Delete again.
   */
  status: "done" | "skipped" | "failed" | "running"
  detail: string
}

export type DeleteResult = {
  /** False only when something that MATTERS failed — a skipped Jellyseerr
   *  cleanup is not a failure, an undeleted file is. */
  ok: boolean
  summary: string
  steps: DeleteStep[]
}

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

type ArrApp = "sonarr" | "radarr"

function arrConfig(app: ArrApp): { base: string; key: string } {
  const base =
    app === "sonarr"
      ? env("SONARR_URL", "http://192.168.178.241:8989")
      : env("RADARR_URL", "http://192.168.178.241:7878")
  const key = app === "sonarr" ? process.env.SONARR_API_KEY : process.env.RADARR_API_KEY
  if (!key) throw new Error(`${app.toUpperCase()}_API_KEY not set`)
  return { base, key }
}

/** Thrown when a file-deleting call outlives its timeout. Distinct from a
 *  failure on purpose — see the catch in deleteMedia. */
class StillRunningError extends Error {}

/**
 * Sonarr and Radarr answer a successful DELETE with an empty body, and
 * `res.json()` on an empty body throws — which would report a successful
 * deletion as a failure. So the body is read as text and only parsed when
 * there is something to parse.
 */
async function arr<T>(
  app: ArrApp,
  method: "GET" | "PUT" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  timeoutMs: number = META_TIMEOUT_MS,
): Promise<T> {
  const { base, key } = arrConfig(app)
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "X-Api-Key": key,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    })
  } catch (err) {
    // Aborting the request does NOT stop the arr app — verified live: the
    // client gave up at 30s and Sonarr kept copying files for minutes after.
    // So a timeout on a delete means "still going", not "did not happen", and
    // saying "failed" here would be a lie that invites a destructive retry.
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new StillRunningError(
        `${app} is still working — the request timed out, the deletion did not stop`,
      )
    }
    throw err
  }
  const text = await res.text()
  if (!res.ok) {
    // The arr apps put a human-readable reason in `message`; surfacing that
    // beats "HTTP 500" by a wide margin when something goes wrong at 1am.
    let reason = `HTTP ${res.status}`
    try {
      const parsed = JSON.parse(text) as { message?: string }
      if (parsed.message) reason = parsed.message
    } catch {
      /* not JSON — the status alone is all there is */
    }
    throw new Error(reason)
  }
  return (text === "" ? null : JSON.parse(text)) as T
}

type SonarrSeason = { seasonNumber: number; monitored: boolean }
type SonarrSeries = { id: number; title: string; seasons: SonarrSeason[] }
type SonarrEpisode = {
  id: number
  seasonNumber: number
  episodeNumber: number
  hasFile: boolean
  episodeFileId: number
}
type RadarrMovie = { id: number; title: string; year: number; hasFile: boolean; movieFileId: number }

/* ------------------------------------------------------------------ *
 * Jellyseerr
 * ------------------------------------------------------------------ */

/**
 * Clearing the Jellyseerr record, which is a genuinely separate thing from
 * deleting the media.
 *
 * Jellyseerr holds a REQUEST record, not the files. Its own
 * `DELETE /media/{id}/file` does delete through Radarr/Sonarr — verified in the
 * running container — but it deliberately leaves its own row behind, so the
 * title keeps reading "Available" until its next Jellyfin sync. Clearing the
 * row is what makes the title requestable again, and it has to happen whichever
 * route did the deleting.
 *
 * The join is `externalServiceId`, which holds the Sonarr series id / Radarr
 * movie id — confirmed end to end (Jellyseerr tv #29 → Sonarr series 13 =
 * Hunters, tmdb 79622 matching on both sides).
 *
 * Absence is normal and is NOT an error. There are currently 18 Jellyseerr
 * records against 6 series + 11 movies, and at least one record
 * (`tv 18`) has no `externalServiceId` at all — so records exist pointing at
 * nothing, and library items exist that were never requested here.
 */
async function clearJellyseerr(mediaType: "movie" | "tv", arrId: number): Promise<DeleteStep> {
  const base = process.env.JELLYSEERR_URL
  const key = process.env.JELLYSEERR_API_KEY
  if (!base || !key) {
    return {
      step: "Jellyseerr record",
      status: "skipped",
      detail: "JELLYSEERR_URL / JELLYSEERR_API_KEY not set — record left as it was",
    }
  }

  try {
    const list = await fetch(`${base}/api/v1/media?take=200`, {
      headers: { "X-Api-Key": key },
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
      cache: "no-store",
    })
    if (!list.ok) throw new Error(`HTTP ${list.status} listing media`)
    const page = (await list.json()) as {
      results: { id: number; mediaType: string; externalServiceId: number | null }[]
    }
    const match = page.results.find((r) => r.mediaType === mediaType && r.externalServiceId === arrId)
    if (!match) {
      return {
        step: "Jellyseerr record",
        status: "skipped",
        detail: "no matching record — this title was never requested through Jellyseerr",
      }
    }

    const del = await fetch(`${base}/api/v1/media/${match.id}`, {
      method: "DELETE",
      headers: { "X-Api-Key": key },
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
      cache: "no-store",
    })
    if (!del.ok) throw new Error(`HTTP ${del.status} deleting record ${match.id}`)
    return {
      step: "Jellyseerr record",
      status: "done",
      detail: `record ${match.id} cleared — requestable again`,
    }
  } catch (err) {
    // Deliberately not fatal. The files are already gone by the time this runs;
    // a stale Jellyseerr row is untidy, not damage.
    return {
      step: "Jellyseerr record",
      status: "failed",
      detail: err instanceof Error ? err.message : "unreachable",
    }
  }
}

/* ------------------------------------------------------------------ *
 * The four operations
 * ------------------------------------------------------------------ */

/**
 * `addImportExclusion` / `addImportListExclusion` are deliberately NOT passed.
 * Both default to false, which is what we want: removing a film should not
 * blocklist it from ever being added again. Leaving the parameter off rather
 * than passing `false` avoids guessing which of the two spellings each app
 * uses — they differ, and an unrecognised query parameter is silently ignored,
 * which would hide a mistake rather than surface one.
 */
/**
 * ORDER MATTERS, and getting it wrong is what went wrong on 2026-08-25.
 *
 * Unmonitoring happens FIRST, before a single byte is deleted, in every one of
 * the four operations below. The original code did the opposite and a timeout
 * left the worst reachable state: three episode files deleted, all ten episodes
 * still monitored — which is exactly what the 23:00 sweep hunts for, so the
 * season would have re-downloaded itself overnight.
 *
 * Reversed, a timeout is harmless. Files may be half-gone, but nothing is
 * monitored, so nothing comes back and the deletion finishes on its own.
 * "Unmonitor first" costs one extra API call and removes the only outcome here
 * that could actually cost money and bandwidth.
 *
 * The spread-the-fetched-object pattern is load-bearing: Radarr and Sonarr PUT
 * replaces the whole resource, and the local types are deliberately narrower
 * than what comes back. Do not rebuild these objects by hand — every unlisted
 * field (path, quality profile, tags) would be wiped.
 */
async function deleteMovie(movieId: number): Promise<DeleteStep[]> {
  const steps: DeleteStep[] = []
  const movie = await arr<RadarrMovie>("radarr", "GET", `/api/v3/movie/${movieId}`)

  await arr("radarr", "PUT", `/api/v3/movie/${movieId}`, { ...movie, monitored: false })
  steps.push({
    step: "Monitoring",
    status: "done",
    detail: "switched off first, so a slow delete cannot leave this re-downloadable",
  })

  await arr("radarr", "DELETE", `/api/v3/movie/${movieId}?deleteFiles=true`, undefined, DELETE_TIMEOUT_MS)
  steps.push({
    step: "Radarr",
    status: "done",
    detail: `${movie.title} (${movie.year}) removed${movie.hasFile ? ", file sent to the recycle bin" : " — it had no file"}`,
  })
  steps.push(await clearJellyseerr("movie", movieId))
  return steps
}

async function deleteSeries(seriesId: number): Promise<DeleteStep[]> {
  const steps: DeleteStep[] = []
  const series = await arr<SonarrSeries>("sonarr", "GET", `/api/v3/series/${seriesId}`)

  // Sonarr will not search for an episode whose SERIES is unmonitored, so this
  // one call covers every episode without touching them individually.
  await arr("sonarr", "PUT", `/api/v3/series/${seriesId}`, {
    ...series,
    monitored: false,
    seasons: series.seasons.map((s) => ({ ...s, monitored: false })),
  })
  steps.push({
    step: "Monitoring",
    status: "done",
    detail: "switched off first, so a slow delete cannot leave episodes re-downloadable",
  })

  await arr("sonarr", "DELETE", `/api/v3/series/${seriesId}?deleteFiles=true`, undefined, DELETE_TIMEOUT_MS)
  steps.push({
    step: "Sonarr",
    status: "done",
    detail: `${series.title} removed, all episode files sent to the recycle bin`,
  })
  steps.push(await clearJellyseerr("tv", seriesId))
  return steps
}

/**
 * A season and an episode share one shape: delete the file(s), then stop
 * wanting them. Neither removes anything from Sonarr, because there is nothing
 * to remove — the series stays, and its other seasons are untouched.
 */
async function deleteSeason(seriesId: number, seasonNumber: number): Promise<DeleteStep[]> {
  const steps: DeleteStep[] = []
  const episodes = await arr<SonarrEpisode[]>("sonarr", "GET", `/api/v3/episode?seriesId=${seriesId}`)
  const inSeason = episodes.filter((e) => e.seasonNumber === seasonNumber)
  const fileIds = inSeason.filter((e) => e.hasFile && e.episodeFileId > 0).map((e) => e.episodeFileId)

  // Both halves are needed. The season flag stops future episodes being wanted;
  // the per-episode flags stop the ones about to be deleted from being
  // re-fetched tonight. Sonarr searches on the EPISODE flag, so the season flag
  // alone would not have saved anything.
  await arr("sonarr", "PUT", "/api/v3/episode/monitor", {
    episodeIds: inSeason.map((e) => e.id),
    monitored: false,
  })
  const series = await arr<SonarrSeries>("sonarr", "GET", `/api/v3/series/${seriesId}`)
  const seasons = series.seasons.map((s) =>
    s.seasonNumber === seasonNumber ? { ...s, monitored: false } : s,
  )
  await arr("sonarr", "PUT", `/api/v3/series/${seriesId}`, { ...series, seasons })
  steps.push({
    step: "Monitoring",
    status: "done",
    detail: `season ${seasonNumber} and its ${inSeason.length} episodes unmonitored first — nothing here can re-download, even if the delete below runs long`,
  })

  if (fileIds.length > 0) {
    // The bulk endpoint rejects an empty list with a 500 ("Sequence contains no
    // elements") rather than treating it as a no-op, hence the guard.
    await arr("sonarr", "DELETE", "/api/v3/episodefile/bulk", { episodeFileIds: fileIds }, DELETE_TIMEOUT_MS)
    steps.push({
      step: "Files",
      status: "done",
      detail: `${fileIds.length} episode file${fileIds.length === 1 ? "" : "s"} sent to the recycle bin`,
    })
  } else {
    steps.push({ step: "Files", status: "skipped", detail: "this season had no files on disk" })
  }

  return steps
}

async function deleteEpisode(
  seriesId: number,
  episodeId: number,
  episodeFileId: number,
): Promise<DeleteStep[]> {
  const steps: DeleteStep[] = []
  await arr("sonarr", "PUT", "/api/v3/episode/monitor", {
    episodeIds: [episodeId],
    monitored: false,
  })
  steps.push({
    step: "Monitoring",
    status: "done",
    detail: "episode unmonitored first — the nightly sweep will not re-download it",
  })

  await arr("sonarr", "DELETE", `/api/v3/episodefile/${episodeFileId}`, undefined, DELETE_TIMEOUT_MS)
  steps.push({ step: "File", status: "done", detail: "sent to the recycle bin" })
  return steps
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export async function deleteMedia(target: DeleteTarget): Promise<DeleteResult> {
  let steps: DeleteStep[] = []
  try {
    switch (target.kind) {
      case "movie":
        steps = await deleteMovie(target.id)
        break
      case "series":
        steps = await deleteSeries(target.id)
        break
      case "season":
        steps = await deleteSeason(target.id, target.seasonNumber)
        break
      case "episode":
        steps = await deleteEpisode(target.id, target.episodeId, target.episodeFileId)
        break
    }
  } catch (err) {
    if (err instanceof StillRunningError) {
      // Monitoring is already off by this point — every operation does that
      // first — so an unfinished delete is safe to simply leave alone.
      steps.push({ step: "Files", status: "running", detail: err.message })
      return {
        ok: true,
        summary:
          "Monitoring is off and the files are still being moved to the recycle bin. This finishes on its own — do not press Delete again.",
        steps,
      }
    }
    // Whatever succeeded before the throw is still reported. Because
    // unmonitoring now runs first, the remaining failure modes leave files in
    // place rather than leaving them wanted.
    steps.push({
      step: "Failed",
      status: "failed",
      detail: err instanceof Error ? err.message : "unknown error",
    })
    return { ok: false, summary: "Delete did not complete", steps }
  }

  // A failed Jellyseerr cleanup does not make the delete a failure — the media
  // is gone either way. Only an arr-side failure lands in the catch above.
  const jellyseerrOnly = steps.every((s) => s.status !== "failed" || s.step === "Jellyseerr record")
  return {
    ok: jellyseerrOnly,
    summary: "Deleted. Files are recoverable for 7 days in /downloads/.recyclebin.",
    steps,
  }
}
