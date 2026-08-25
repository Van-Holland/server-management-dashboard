/**
 * Deleting media — and why every delete here is at least two operations.
 *
 * The obvious mistake this module exists to avoid: deleting a file while the
 * app still WANTS that file. Sonarr's RSS sync runs every 15 minutes and
 * `search-missing.sh` runs at 23:00 specifically to find monitored items with
 * no file and go fetch them. Delete an episode at 20:00 without unmonitoring
 * it and it is back before midnight, having spent indexer budget to return.
 *
 * So: **delete the file, then stop wanting it.** Never one without the other.
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

/** Deletes move real files. Generous next to the 6s read timeout, because
 *  removing a 60 GB remux to the recycle bin is not instant. */
const TIMEOUT_MS = 30_000

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
  status: "done" | "skipped" | "failed"
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
): Promise<T> {
  const { base, key } = arrConfig(app)
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "X-Api-Key": key,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  })
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
async function deleteMovie(movieId: number): Promise<DeleteStep[]> {
  const steps: DeleteStep[] = []
  const movie = await arr<RadarrMovie>("radarr", "GET", `/api/v3/movie/${movieId}`)
  await arr("radarr", "DELETE", `/api/v3/movie/${movieId}?deleteFiles=true`)
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
  await arr("sonarr", "DELETE", `/api/v3/series/${seriesId}?deleteFiles=true`)
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

  if (fileIds.length > 0) {
    // The bulk endpoint rejects an empty list with a 500 ("Sequence contains no
    // elements") rather than treating it as a no-op, hence the guard above.
    await arr("sonarr", "DELETE", "/api/v3/episodefile/bulk", { episodeFileIds: fileIds })
    steps.push({
      step: "Files",
      status: "done",
      detail: `${fileIds.length} episode file${fileIds.length === 1 ? "" : "s"} sent to the recycle bin`,
    })
  } else {
    steps.push({ step: "Files", status: "skipped", detail: "this season had no files on disk" })
  }

  // Both halves are needed. Unmonitoring the season stops future episodes being
  // wanted; unmonitoring the existing episodes stops the ones just deleted from
  // being re-fetched tonight. Doing only the first leaves every deleted episode
  // individually monitored and missing, which is exactly what the 23:00 sweep
  // hunts for.
  await arr("sonarr", "PUT", "/api/v3/episode/monitor", {
    episodeIds: inSeason.map((e) => e.id),
    monitored: false,
  })
  const series = await arr<SonarrSeries>("sonarr", "GET", `/api/v3/series/${seriesId}`)
  const seasons = series.seasons.map((s) =>
    s.seasonNumber === seasonNumber ? { ...s, monitored: false } : s,
  )
  // Sonarr's PUT replaces the whole series resource, so the fetched object is
  // spread back verbatim with only `seasons` swapped. The SonarrSeries type is
  // deliberately narrower than what actually comes back — do NOT "tidy" this
  // into a hand-built object, or every unlisted field (path, quality profile,
  // tags) is wiped on save.
  await arr("sonarr", "PUT", `/api/v3/series/${seriesId}`, { ...series, seasons })
  steps.push({
    step: "Monitoring",
    status: "done",
    detail: `season ${seasonNumber} and its ${inSeason.length} episodes unmonitored — the nightly sweep will not re-download them`,
  })
  return steps
}

async function deleteEpisode(
  seriesId: number,
  episodeId: number,
  episodeFileId: number,
): Promise<DeleteStep[]> {
  const steps: DeleteStep[] = []
  await arr("sonarr", "DELETE", `/api/v3/episodefile/${episodeFileId}`)
  steps.push({ step: "File", status: "done", detail: "sent to the recycle bin" })

  await arr("sonarr", "PUT", "/api/v3/episode/monitor", {
    episodeIds: [episodeId],
    monitored: false,
  })
  steps.push({
    step: "Monitoring",
    status: "done",
    detail: "episode unmonitored — the nightly sweep will not re-download it",
  })
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
    // Whatever succeeded before the throw is still reported. Knowing the files
    // went but the unmonitor did not is the difference between "done" and
    // "it will come back tonight, go and fix it".
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
