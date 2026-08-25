import { readFile } from "node:fs/promises"

/**
 * Media library and upgrade-system reporting.
 *
 * Why this page exists, stated plainly because it shapes every decision below:
 * on 2026-08-24 The Hardacres S02 was playing at 1.86 Mbps — 599 MB for a
 * 45-minute episode — while a 2413 MB copy sat on the indexers every night.
 * Nothing was broken. Sonarr scored the two as a TIE, because it grades by
 * quality *type* and both were "WEBDL-1080p". Size never entered the comparison.
 *
 * The consequence for this module: **a quality label is not evidence of
 * quality.** A page that showed "WEBDL-1080p" in green would have shown green
 * for the runt, every day, for three weeks. So every file here carries its size
 * and its measured bitrate, and those are the numbers given prominence.
 *
 * Reading is READ-ONLY and stays that way. There are deliberately no grab or
 * search-now actions — a dashboard that can start downloads is a dashboard that
 * can start them by accident, and the whole point of the nightly sweep's batch
 * cap is keeping the indexer budget under control.
 *
 * Deleting is the one exception, added 2026-08-25, and the exception is
 * narrow on purpose. The argument above has two halves and only one of them
 * survives here: an accidental delete costs no indexer budget at all, and since
 * every delete goes through Sonarr/Radarr it lands in their recycle bin
 * (`/downloads/.recyclebin`, 7-day retention, verified live on both apps) — so
 * the worst case is a restore, not a re-download. The "by accident" half still
 * applies, which is why the delete path lives in lib/media-delete.ts behind a
 * confirmation that names what is going, and why it always pairs a file
 * deletion with an unmonitor. This module still only reads.
 */

/**
 * In the container the host filesystem is mounted read-only at /host/root.
 * Overridable so the page can be developed and verified on a laptop against a
 * copy of the two state files — without it, local runs silently render an empty
 * sweep history, which is the one part of this page hardest to eyeball.
 */
const HOST = process.env.HOST_ROOT ?? "/host/root"
const UPGRADE_STATE = `${HOST}/home/matt/scripts/upgrade-state.json`
const UPGRADE_HISTORY = `${HOST}/home/matt/scripts/upgrade-history.jsonl`

/**
 * The sweep's cron line is `0 23 * * *`, but this container runs as `node` and
 * /var/spool/cron/crontabs/matt is 0600 root — unreadable here. So this is a
 * MIRROR of the crontab, not a reading of it. If the cron time changes, change
 * this too. The honest signal is not this constant but `lastRunAgeHours`
 * below: if the sweep stops running, the age climbs and the page says so,
 * regardless of what hour this claims.
 */
const SWEEP_HOUR = 23
/** A daily job that has not run in this long has missed at least one slot. */
const SWEEP_STALE_HOURS = 26

/**
 * Rough "this file looks thin for its resolution" thresholds, in Mbps.
 *
 * Deliberately advisory, never a verdict. Encoding rates vary legitimately with
 * codec and content — a well-encoded x265 file can look fine below these, and a
 * bad x264 one can look poor above them. The purpose is only to make a runt
 * catch the eye, which is precisely what did NOT happen when the only thing on
 * screen was the words "WEBDL-1080p".
 */
const THIN_MBPS: { minHeight: number; mbps: number }[] = [
  { minHeight: 2160, mbps: 12 },
  { minHeight: 1080, mbps: 3 },
  { minHeight: 0, mbps: 1.5 },
]

export type MediaFile = {
  /** Namespaced the same way the sweep's state file does: "sonarr:74". */
  key: string
  label: string
  /**
   * Sonarr's own ids, needed to delete and to unmonitor — null on films.
   *
   * These are three different numbers and confusing them silently deletes the
   * wrong thing: `key` carries the EPISODE id, `episodeFileId` is the id of the
   * file on disk, and only the latter is what `DELETE /episodefile/{id}`
   * accepts. Both are carried explicitly rather than parsed back out of `key`.
   */
  episodeId: number | null
  episodeFileId: number | null
  /** Null on films. Season 0 is real — Sonarr stores specials there. */
  seasonNumber: number | null
  quality: string
  sizeBytes: number
  runtimeSec: number | null
  /**
   * Overall bitrate (video + audio + everything), computed as size ÷ runtime.
   *
   * NOT read from the API: Sonarr reports `mediaInfo.videoBitrate` as 0 for
   * many files while Radarr populates it, so trusting that field would leave
   * most TV rows blank — and the blank rows would be exactly the ones worth
   * looking at. size ÷ runtime always works and matches what ffprobe reports
   * for the container (verified against S02E05: 1.86 Mbps both ways).
   */
  bitrateBps: number | null
  codec: string | null
  resolutionHeight: number | null
  customFormatScore: number
  /** True when the app itself wants a better copy of this. */
  wantsUpgrade: boolean
  /** Sweep bookkeeping, present only for items on the upgrade list. */
  lane: "fast" | "slow" | null
  attempts: number | null
  lastCheckedMs: number | null
  /** Advisory only — see THIN_MBPS. */
  thin: boolean
}

export type MediaGroup = {
  id: string
  title: string
  /**
   * The Sonarr series id or Radarr movie id, unprefixed.
   *
   * `id` above is a DOM key ("series-13") and is not interchangeable with this.
   * This is also the number Jellyseerr stores as `externalServiceId`, which is
   * how a deleted title is matched back to its request record.
   */
  arrId: number
  kind: "series" | "movie"
  files: MediaFile[]
  totalBytes: number
  /** Episodes/movies monitored but with no file at all. */
  missingCount: number
}

export type UpgradeRules = {
  app: "Sonarr" | "Radarr"
  profileName: string
  /** The "stop looking" line — reaching it takes an item off the upgrade list. */
  cutoffName: string
  minFormatScore: number
  formats: { name: string; score: number }[]
  cutoffUnmetTotal: number
  /** Most items this app's sweep will search in one night. */
  nightlyBatch: number
}

export type SweepRun = {
  tsMs: number
  app: string
  cutoffTotal: number
  due: number
  checked: number[]
  resolved: number
  commandId: number | null
  error?: string
}

export type MediaSnapshot = {
  groups: MediaGroup[]
  rules: UpgradeRules[]
  history: SweepRun[]
  lastRunMs: number | null
  lastRunAgeHours: number | null
  sweepStale: boolean
  nextRunMs: number
  checkedMs: number
  /** Anything that could not be reached. Named, never swallowed. */
  errors: string[]
  /**
   * Things worth saying that are NOT failures — kept separate on purpose. A
   * note like "shows span 2 profiles" rendered under a red "could not be read"
   * heading teaches you to distrust the red heading, which is the one thing on
   * this page that has to stay believable.
   */
  notes: string[]
}

const TIMEOUT_MS = 6000

/** Batch caps as configured in search-missing.sh. Mirrored here for display
 *  only; the script is the source of truth. */
const NIGHTLY_BATCH = { Sonarr: 10, Radarr: 3 } as const

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

async function api<T>(base: string, key: string, path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    headers: { "X-Api-Key": key },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  return (await res.json()) as T
}

/** Radarr says "2:33:08", Sonarr says "45:57". Both also emit "0:00" for files
 *  whose media info never got scanned — treated as unknown, not as zero. */
export function parseRuntime(raw: string | null | undefined): number | null {
  if (!raw) return null
  const parts = raw.split(":").map((p) => Number.parseInt(p, 10))
  if (parts.some((p) => Number.isNaN(p))) return null
  const sec =
    parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts.length === 2
        ? parts[0] * 60 + parts[1]
        : parts[0]
  return sec > 0 ? sec : null
}

function heightFrom(resolution: string | null | undefined): number | null {
  if (!resolution) return null
  const m = resolution.match(/x(\d+)/)
  return m ? Number.parseInt(m[1], 10) : null
}

function isThin(bitrateBps: number | null, height: number | null): boolean {
  if (bitrateBps === null) return false
  const rule = THIN_MBPS.find((r) => (height ?? 0) >= r.minHeight) ?? THIN_MBPS[THIN_MBPS.length - 1]
  return bitrateBps / 1_000_000 < rule.mbps
}

type StateEntry = { firstSeen: number; lastChecked: number | null; attempts: number; lane: string }
type SweepState = Record<string, StateEntry>

async function readState(): Promise<SweepState> {
  try {
    return JSON.parse(await readFile(UPGRADE_STATE, "utf-8")) as SweepState
  } catch {
    return {}
  }
}

async function readHistory(limit = 14): Promise<SweepRun[]> {
  try {
    const raw = await readFile(UPGRADE_HISTORY, "utf-8")
    const runs = raw
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        try {
          const j = JSON.parse(line) as Record<string, unknown>
          const run: SweepRun = {
            tsMs: Date.parse(String(j.ranAtIso ?? j.ts)),
            app: String(j.app ?? "?"),
            cutoffTotal: Number(j.cutoff_total ?? 0),
            due: Number(j.due ?? 0),
            checked: Array.isArray(j.checked) ? (j.checked as number[]) : [],
            resolved: Number(j.resolved ?? 0),
            commandId: j.command_id === null || j.command_id === undefined ? null : Number(j.command_id),
          }
          // Assigned only when present — `error: undefined` is not the same as
          // absent under exactOptionalPropertyTypes, and the difference is what
          // the type checker objected to.
          if (typeof j.error === "string") run.error = j.error
          return run
        } catch {
          return null
        }
      })
      .filter((r): r is SweepRun => r !== null && Number.isFinite(r.tsMs))
    return runs.slice(-limit).reverse()
  } catch {
    return []
  }
}

/** Next occurrence of SWEEP_HOUR in the container's local time (TZ is set to
 *  Europe/Amsterdam in docker-compose; see the zoneinfo mount note there). */
function nextRunAfter(now: Date): number {
  const next = new Date(now)
  next.setHours(SWEEP_HOUR, 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime()
}

/**
 * The upgrade list itself, not just its size.
 *
 * Membership has to come from here rather than from the sweep's state file.
 * The state file only changes when the sweep runs, so between runs it goes
 * stale in the one direction that misleads: on 2026-08-25 six Silo episodes
 * reached 4K overnight and left the list, and the page still showed them as
 * "still hunting" — 28 flagged against a live count of 22. Reading the live
 * list costs one already-made request returning more rows.
 */
type CutoffPage = { totalRecords: number; records?: { id: number }[] }

type ProfileItem = { quality?: { id: number; name: string }; id?: number; name?: string }
type Profile = {
  id: number
  name: string
  cutoff: number
  minFormatScore: number
  items: ProfileItem[]
  formatItems: { name: string; score: number }[]
}

function cutoffName(profile: Profile): string {
  const flat = profile.items.map((i) =>
    i.quality ? { id: i.quality.id, name: i.quality.name } : { id: i.id ?? -1, name: i.name ?? "?" },
  )
  return flat.find((f) => f.id === profile.cutoff)?.name ?? `id ${profile.cutoff}`
}

type SonarrEpisode = {
  id: number
  seasonNumber: number
  episodeNumber: number
  monitored: boolean
  hasFile: boolean
  episodeFileId: number
  episodeFile?: {
    quality: { quality: { name: string } }
    size: number
    customFormatScore?: number
    mediaInfo?: { runTime?: string; videoCodec?: string; resolution?: string }
  }
}

async function loadSonarr(
  state: SweepState,
  errors: string[],
  notes: string[],
): Promise<{ groups: MediaGroup[]; rules: UpgradeRules | null }> {
  const base = env("SONARR_URL", "http://192.168.178.241:8989")
  const key = process.env.SONARR_API_KEY
  if (!key) {
    errors.push("Sonarr: SONARR_API_KEY not set")
    return { groups: [], rules: null }
  }

  let rules: UpgradeRules | null = null
  const groups: MediaGroup[] = []

  try {
    const series = await api<{ id: number; title: string; qualityProfileId: number }[]>(base, key, "/api/v3/series")

    const [profiles, cutoff] = await Promise.all([
      api<Profile[]>(base, key, "/api/v3/qualityprofile"),
      api<CutoffPage>(base, key, "/api/v3/wanted/cutoff?pageSize=500"),
    ])

    // Report the profile the library actually uses, not profile 1. If shows are
    // split across profiles, the most-used one is shown and the rest are noted.
    const unmet = new Set((cutoff.records ?? []).map((r) => r.id))

    const counts = new Map<number, number>()
    for (const s of series) counts.set(s.qualityProfileId, (counts.get(s.qualityProfileId) ?? 0) + 1)
    const mainId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const main = profiles.find((p) => p.id === mainId)
    if (main) {
      rules = {
        app: "Sonarr",
        profileName: main.name,
        cutoffName: cutoffName(main),
        minFormatScore: main.minFormatScore,
        formats: (main.formatItems ?? []).filter((f) => f.score !== 0),
        cutoffUnmetTotal: cutoff.totalRecords,
        nightlyBatch: NIGHTLY_BATCH.Sonarr,
      }
      if (counts.size > 1) notes.push(`Sonarr: shows span ${counts.size} profiles — showing "${main.name}", the one most use`)
    }

    for (const s of series) {
      const episodes = await api<SonarrEpisode[]>(
        base,
        key,
        `/api/v3/episode?seriesId=${s.id}&includeEpisodeFile=true`,
      )
      const files: MediaFile[] = []
      let missing = 0
      for (const ep of episodes) {
        if (!ep.hasFile || !ep.episodeFile) {
          if (ep.monitored) missing += 1
          continue
        }
        const st = state[`sonarr:${ep.id}`]
        const runtimeSec = parseRuntime(ep.episodeFile.mediaInfo?.runTime)
        const bitrateBps = runtimeSec ? Math.round((ep.episodeFile.size * 8) / runtimeSec) : null
        const height = heightFrom(ep.episodeFile.mediaInfo?.resolution)
        files.push({
          key: `sonarr:${ep.id}`,
          label: `S${String(ep.seasonNumber).padStart(2, "0")}E${String(ep.episodeNumber).padStart(2, "0")}`,
          episodeId: ep.id,
          episodeFileId: ep.episodeFileId,
          seasonNumber: ep.seasonNumber,
          quality: ep.episodeFile.quality.quality.name,
          sizeBytes: ep.episodeFile.size,
          runtimeSec,
          bitrateBps,
          codec: ep.episodeFile.mediaInfo?.videoCodec ?? null,
          resolutionHeight: height,
          customFormatScore: ep.episodeFile.customFormatScore ?? 0,
          wantsUpgrade: unmet.has(ep.id),
          lane: st ? ((st.lane as "fast" | "slow") ?? null) : null,
          attempts: st ? st.attempts : null,
          lastCheckedMs: st?.lastChecked ? st.lastChecked * 1000 : null,
          thin: isThin(bitrateBps, height),
        })
      }
      files.sort((a, b) => a.label.localeCompare(b.label))
      if (files.length > 0 || missing > 0) {
        groups.push({
          id: `series-${s.id}`,
          arrId: s.id,
          title: s.title,
          kind: "series",
          files,
          totalBytes: files.reduce((n, f) => n + f.sizeBytes, 0),
          missingCount: missing,
        })
      }
    }
  } catch (err) {
    errors.push(`Sonarr: ${err instanceof Error ? err.message : "unreachable"}`)
  }

  return { groups, rules }
}

type RadarrMovie = {
  id: number
  title: string
  year: number
  monitored: boolean
  hasFile: boolean
  qualityProfileId: number
  movieFile?: {
    quality: { quality: { name: string } }
    size: number
    customFormatScore?: number
    mediaInfo?: { runTime?: string; videoCodec?: string; resolution?: string }
  }
}

async function loadRadarr(state: SweepState, errors: string[]): Promise<{ groups: MediaGroup[]; rules: UpgradeRules | null }> {
  const base = env("RADARR_URL", "http://192.168.178.241:7878")
  const key = process.env.RADARR_API_KEY
  if (!key) {
    errors.push("Radarr: RADARR_API_KEY not set")
    return { groups: [], rules: null }
  }

  let rules: UpgradeRules | null = null
  const groups: MediaGroup[] = []

  try {
    const [movies, profiles, cutoff] = await Promise.all([
      api<RadarrMovie[]>(base, key, "/api/v3/movie"),
      api<Profile[]>(base, key, "/api/v3/qualityprofile"),
      api<CutoffPage>(base, key, "/api/v3/wanted/cutoff?pageSize=500"),
    ])

    const unmet = new Set((cutoff.records ?? []).map((r) => r.id))

    const counts = new Map<number, number>()
    for (const m of movies) counts.set(m.qualityProfileId, (counts.get(m.qualityProfileId) ?? 0) + 1)
    const mainId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const main = profiles.find((p) => p.id === mainId)
    if (main) {
      rules = {
        app: "Radarr",
        profileName: main.name,
        cutoffName: cutoffName(main),
        minFormatScore: main.minFormatScore,
        formats: (main.formatItems ?? []).filter((f) => f.score !== 0),
        cutoffUnmetTotal: cutoff.totalRecords,
        nightlyBatch: NIGHTLY_BATCH.Radarr,
      }
    }

    for (const m of movies) {
      if (!m.hasFile || !m.movieFile) {
        groups.push({
          id: `movie-${m.id}`,
          arrId: m.id,
          title: `${m.title} (${m.year})`,
          kind: "movie",
          files: [],
          totalBytes: 0,
          missingCount: m.monitored ? 1 : 0,
        })
        continue
      }
      const st = state[`radarr:${m.id}`]
      const runtimeSec = parseRuntime(m.movieFile.mediaInfo?.runTime)
      const bitrateBps = runtimeSec ? Math.round((m.movieFile.size * 8) / runtimeSec) : null
      const height = heightFrom(m.movieFile.mediaInfo?.resolution)
      groups.push({
        id: `movie-${m.id}`,
        arrId: m.id,
        title: `${m.title} (${m.year})`,
        kind: "movie",
        files: [
          {
            key: `radarr:${m.id}`,
            label: "Film",
            // Films have no episode or season identity. Carrying null rather
            // than reusing the movie id keeps a film from ever being routed
            // into a Sonarr call by mistake.
            episodeId: null,
            episodeFileId: null,
            seasonNumber: null,
            quality: m.movieFile.quality.quality.name,
            sizeBytes: m.movieFile.size,
            runtimeSec,
            bitrateBps,
            codec: m.movieFile.mediaInfo?.videoCodec ?? null,
            resolutionHeight: height,
            customFormatScore: m.movieFile.customFormatScore ?? 0,
            wantsUpgrade: unmet.has(m.id),
            lane: st ? ((st.lane as "fast" | "slow") ?? null) : null,
            attempts: st ? st.attempts : null,
            lastCheckedMs: st?.lastChecked ? st.lastChecked * 1000 : null,
            thin: isThin(bitrateBps, height),
          },
        ],
        totalBytes: m.movieFile.size,
        missingCount: 0,
      })
    }
  } catch (err) {
    errors.push(`Radarr: ${err instanceof Error ? err.message : "unreachable"}`)
  }

  return { groups, rules }
}

export async function getMedia(): Promise<MediaSnapshot> {
  const errors: string[] = []
  const notes: string[] = []
  const state = await readState()

  const [sonarr, radarr, history] = await Promise.all([
    loadSonarr(state, errors, notes),
    loadRadarr(state, errors),
    readHistory(),
  ])

  const groups = [
    ...sonarr.groups.sort((a, b) => a.title.localeCompare(b.title)),
    ...radarr.groups.sort((a, b) => a.title.localeCompare(b.title)),
  ]
  const rules = [sonarr.rules, radarr.rules].filter((r): r is UpgradeRules => r !== null)

  const now = Date.now()
  const lastRunMs = history.length > 0 ? history[0].tsMs : null
  const lastRunAgeHours = lastRunMs === null ? null : (now - lastRunMs) / 3_600_000

  return {
    groups,
    rules,
    history,
    lastRunMs,
    lastRunAgeHours,
    // Unknown counts as stale. A sweep nobody can find evidence of is not a
    // sweep that ran — the same reasoning the backups page uses for "unknown".
    sweepStale: lastRunAgeHours === null || lastRunAgeHours > SWEEP_STALE_HOURS,
    nextRunMs: nextRunAfter(new Date(now)),
    checkedMs: now,
    errors,
    notes,
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(bytes >= 10_737_418_240 ? 0 : 1)} GB`
  return `${Math.round(bytes / 1_048_576)} MB`
}

export function formatMbps(bitrateBps: number | null): string {
  if (bitrateBps === null) return "—"
  return `${(bitrateBps / 1_000_000).toFixed(2)} Mbps`
}

export function formatRuntime(sec: number | null): string {
  if (sec === null) return "—"
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
