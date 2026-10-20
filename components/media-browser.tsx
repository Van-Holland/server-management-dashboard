"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { Film, Search, Tv, X } from "lucide-react"
import { formatBytes, formatMbps, formatRuntime } from "@/lib/media-format"
import type { MediaFile, MediaGroup, MissingEpisode } from "@/lib/media"
import { DeleteMediaButton } from "@/components/delete-media-button"

/**
 * The library as a grid of posters.
 *
 * Everything that used to be a paragraph on this page is now a badge on a tile:
 * "thin" (a low bitrate for the resolution, see lib/media.ts) and "missing".
 * The episode table, bitrates and every delete button moved into the detail
 * panel, so they are one click away instead of 4,000 pixels of scrolling.
 *
 * A client component because filtering and the detail panel are pure UI state.
 * The data arrives already fetched by the server page; nothing here talks to
 * Sonarr or Radarr, except the poster images, which go through our own route.
 */

type KindFilter = "all" | "series" | "movie"
type SortKey = "az" | "size" | "bitrate"

function seasonLabel(n: number): string {
  return n === 0 ? "Specials" : `Season ${n}`
}

function thinCount(g: MediaGroup): number {
  return g.files.filter((f) => f.thin).length
}

/** The resolution most of a title's files have, as a short badge. */
function qualityBadge(g: MediaGroup): string | null {
  const counts = new Map<string, number>()
  for (const f of g.files) {
    const h = f.resolutionHeight
    const label = h === null ? f.quality : h >= 2160 ? "4K" : h >= 1080 ? "1080p" : h >= 720 ? "720p" : "SD"
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** Lowest bitrate among a title's files — the one worth looking at first. */
function lowestBitrate(g: MediaGroup): number {
  const rates = g.files.map((f) => f.bitrateBps).filter((b): b is number => b !== null)
  return rates.length > 0 ? Math.min(...rates) : Number.POSITIVE_INFINITY
}

/** "Fri 23 Oct". Fixed to the server's timezone so server and browser agree. */
function airDate(ms: number | null): string | null {
  if (ms === null) return null
  return new Date(ms).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Amsterdam",
  })
}

function Poster({ group }: { group: MediaGroup }) {
  const [failed, setFailed] = useState(false)
  const Icon = group.kind === "series" ? Tv : Film
  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        <Icon className="size-8" aria-hidden="true" />
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- next/image is disabled in this project (unoptimized)
    <img
      src={`/api/media/poster/${group.kind}/${group.arrId}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  )
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`rounded px-1 py-0.5 text-[0.55rem] font-medium leading-none sm:rounded-md sm:px-1.5 sm:text-[0.7rem] ${className}`}>
      {children}
    </span>
  )
}

function Tile({ group, onOpen }: { group: MediaGroup; onOpen: () => void }) {
  const thin = thinCount(group)
  const quality = qualityBadge(group)
  const empty = group.files.length === 0
  const isSeries = group.kind === "series"

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group overflow-hidden rounded-lg border sm:rounded-xl border-border bg-card text-left transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
    >
      <div className="relative aspect-[2/3] bg-secondary">
        <div className={`h-full w-full ${empty ? "opacity-40" : ""}`}>
          <Poster group={group} />
        </div>
        {quality && (
          <span className="absolute left-1 top-1 sm:left-2 sm:top-2">
            <Badge className="bg-black/70 text-white">{quality}</Badge>
          </span>
        )}
        {(thin > 0 || group.missingCount > 0 || group.upcomingCount > 0) && (
          <span className="absolute bottom-1 left-1 flex sm:bottom-2 sm:left-2 flex-col items-start gap-1">
            {thin > 0 && (
              <Badge className="bg-usage-mid text-black">{isSeries ? `${thin} thin` : "thin"}</Badge>
            )}
            {group.missingCount > 0 && (
              <Badge className="bg-usage-high text-white">
                {isSeries && !empty ? `${group.missingCount} missing` : "missing"}
              </Badge>
            )}
            {group.upcomingCount > 0 && (
              <Badge className="bg-black/70 text-white">
                {isSeries && !empty ? `${group.upcomingCount} coming` : "coming"}
              </Badge>
            )}
          </span>
        )}
      </div>
      <div className="px-1.5 py-1.5 sm:px-2.5 sm:py-2">
        <p className="truncate text-[0.65rem] font-medium sm:text-sm text-foreground">{group.title}</p>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">
          {empty
            ? group.missingCount === 0 && group.upcomingCount > 0
              ? "Not out yet"
              : "Not downloaded"
            : isSeries
              ? `${group.files.length} ep · ${formatBytes(group.totalBytes)}`
              : formatBytes(group.totalBytes)}
        </p>
      </div>
    </button>
  )
}

function FileRow({ file, action }: { file: MediaFile; action: React.ReactNode }) {
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
      <td className="py-1 text-right">{action}</td>
    </tr>
  )
}

/** Columns before the delete column, so a season header's colSpan cannot drift. */
const DATA_COLUMNS = 5

type Row = { kind: "file"; file: MediaFile } | { kind: "missing"; episode: MissingEpisode }

/** A gap in the season: faded, so it reads as "not here" next to real files. */
function MissingRow({ episode }: { episode: MissingEpisode }) {
  const date = airDate(episode.airDateMs)
  return (
    <tr className="border-t border-border/60">
      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground/60">{episode.label}</td>
      <td colSpan={DATA_COLUMNS - 1} className="py-2 pr-3 text-xs">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-muted-foreground/60">{episode.title ?? "TBA"}</span>
          {episode.aired ? (
            <span className="shrink-0 font-medium text-usage-high">missing</span>
          ) : (
            <span className="shrink-0 text-muted-foreground">{date ? `airs ${date}` : "date not set"}</span>
          )}
        </span>
      </td>
      <td />
    </tr>
  )
}

function FileTable({ group }: { group: MediaGroup }) {
  const bySeason = new Map<number, Row[]>()
  const push = (n: number, row: Row) => {
    const bucket = bySeason.get(n)
    if (bucket) bucket.push(row)
    else bySeason.set(n, [row])
  }
  for (const f of group.files) push(f.seasonNumber ?? -1, { kind: "file", file: f })
  for (const m of group.missingEpisodes) push(m.seasonNumber, { kind: "missing", episode: m })
  // Labels are "S02E06", zero-padded, so a plain string sort is episode order.
  const labelOf = (r: Row) => (r.kind === "file" ? r.file.label : r.episode.label)
  for (const rows of bySeason.values()) rows.sort((a, b) => labelOf(a).localeCompare(labelOf(b)))

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left">
        <thead>
          <tr className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
            <th className="pb-1 pr-3 font-medium">Item</th>
            <th className="pb-1 pr-3 font-medium">Quality</th>
            <th className="pb-1 pr-3 text-right font-medium">Size</th>
            <th className="pb-1 pr-3 text-right font-medium">Bitrate</th>
            <th className="pb-1 pr-3 text-right font-medium">Runtime</th>
            <th className="pb-1 text-right font-medium">
              <span className="sr-only">Delete</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {group.kind === "movie"
            ? group.files.map((f) => <FileRow key={f.key} file={f} action={null} />)
            : [...bySeason.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([seasonNumber, rows]) => {
                const files = rows.flatMap((r) => (r.kind === "file" ? [r.file] : []))
                const seasonBytes = files.reduce((n, f) => n + f.sizeBytes, 0)
                return (
                  <Fragment key={seasonNumber}>
                    <tr className="border-t border-border/60 bg-secondary/20">
                      <td colSpan={DATA_COLUMNS} className="py-1.5 pr-3 text-xs font-medium text-foreground">
                        {seasonLabel(seasonNumber)}
                        <span className="ml-2 font-normal text-muted-foreground">
                          · {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(seasonBytes)}
                        </span>
                      </td>
                      <td className="py-1 text-right">
                        {/* A season of only gaps has no files, so nothing to delete. */}
                        {files.length > 0 && (
                        <DeleteMediaButton
                          size="sm"
                          target={{ kind: "season", id: group.arrId, seasonNumber }}
                          title={`${group.title} — ${seasonLabel(seasonNumber)}`}
                          detail={`${files.length} file${files.length === 1 ? "" : "s"} · ${formatBytes(seasonBytes)}`}
                          removesEntry={false}
                        />
                        )}
                      </td>
                    </tr>
                    {rows.map((r) =>
                      r.kind === "missing" ? (
                        <MissingRow key={`missing-${r.episode.label}`} episode={r.episode} />
                      ) : (
                      <FileRow
                        key={r.file.key}
                        file={r.file}
                        action={
                          // Both ids are required by the API route, so a row that
                          // lacks either gets no button rather than one that fails.
                          r.file.episodeId !== null && r.file.episodeFileId !== null ? (
                            <DeleteMediaButton
                              size="sm"
                              target={{
                                kind: "episode",
                                id: group.arrId,
                                episodeId: r.file.episodeId,
                                episodeFileId: r.file.episodeFileId,
                              }}
                              title={`${group.title} — ${r.file.label}`}
                              detail={`${r.file.quality} · ${formatBytes(r.file.sizeBytes)}`}
                              removesEntry={false}
                            />
                          ) : null
                        }
                      />
                      ),
                    )}
                  </Fragment>
                )
              })}
        </tbody>
      </table>
    </div>
  )
}

function DetailPanel({ group, onClose }: { group: MediaGroup; onClose: () => void }) {
  const thin = thinCount(group)
  const parts = [
    group.files.length > 0
      ? `${group.files.length} file${group.files.length === 1 ? "" : "s"} · ${formatBytes(group.totalBytes)}`
      : "Nothing on disk yet",
  ]

  return (
    <div className="p-5">
      <div className="flex items-start gap-4">
        <div className="aspect-[2/3] w-16 shrink-0 overflow-hidden rounded-lg bg-secondary">
          <Poster group={group} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-foreground">{group.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {parts[0]}
            {thin > 0 && <span className="text-usage-high"> · {thin} thin</span>}
            {group.missingCount > 0 && <span className="text-usage-high"> · {group.missingCount} missing</span>}
            {group.upcomingCount > 0 && (
              <span>
                {" "}
                · {group.kind === "movie" ? "not out yet" : `${group.upcomingCount} not aired yet`}
              </span>
            )}
          </p>
        </div>
        <DeleteMediaButton
          target={group.kind === "movie" ? { kind: "movie", id: group.arrId } : { kind: "series", id: group.arrId }}
          title={group.title}
          detail={
            group.files.length === 0
              ? "Nothing on disk — this removes the entry only"
              : `${group.files.length} file${group.files.length === 1 ? "" : "s"} · ${formatBytes(group.totalBytes)}`
          }
          removesEntry
        />
        <button
          type="button"
          onClick={onClose}
          // Focused by the dialog effect below (React's autoFocus runs while
          // the dialog is still closed, so the browser then picks the first
          // button — the delete icon — and rings the most dangerous control).
          data-autofocus
          aria-label="Close"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {(group.files.length > 0 || group.missingEpisodes.length > 0) && (
        <div className="mt-5">
          <FileTable group={group} />
        </div>
      )}
    </div>
  )
}

export function MediaBrowser({ groups }: { groups: MediaGroup[] }) {
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<KindFilter>("all")
  const [onlyKids, setOnlyKids] = useState(false)
  // Titles with no file at all are hidden by default, so the grid shows what can
  // actually be watched. This switches to showing ONLY those.
  const [onlyEmpty, setOnlyEmpty] = useState(false)
  const [sort, setSort] = useState<SortKey>("az")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  // Counted inside the current Kids view, so the number on the button is the
  // number of tiles you will actually get when you press it.
  const emptyTitles = groups.filter((g) => g.files.length === 0 && g.kids === onlyKids).length

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = groups.filter(
      (g) =>
        (kind === "all" || g.kind === kind) &&
        // Kids' titles stay out of the normal view; the Kids button swaps to them.
        g.kids === onlyKids &&
        (onlyEmpty ? g.files.length === 0 : g.files.length > 0) &&
        (q === "" || g.title.toLowerCase().includes(q)),
    )
    if (sort === "size") list.sort((a, b) => b.totalBytes - a.totalBytes || a.title.localeCompare(b.title))
    else if (sort === "bitrate") list.sort((a, b) => lowestBitrate(a) - lowestBitrate(b) || a.title.localeCompare(b.title))
    else list.sort((a, b) => a.title.localeCompare(b.title))
    return list
  }, [groups, query, kind, onlyKids, onlyEmpty, sort])

  // After a delete the server re-renders without the title; the panel must
  // close rather than keep showing something that no longer exists.
  const selected = groups.find((g) => g.id === selectedId) ?? null

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (selected && !dialog.open) {
      dialog.showModal()
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus()
    }
    if (!selected && dialog.open) dialog.close()
  }, [selected])

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs transition-colors ${
      active
        ? "border-foreground/40 bg-secondary text-foreground"
        : "border-border text-muted-foreground hover:text-foreground"
    }`

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <span className="sr-only">Search titles</span>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles"
            className="w-44 rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
          />
        </label>

        {(
          [
            ["all", "All"],
            ["series", "TV"],
            ["movie", "Films"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setKind(value)} className={chip(kind === value)}>
            {label}
          </button>
        ))}

        {/* Same look as All / TV / Films, but a toggle that combines with them:
            Kids + Films shows kids' films only. Click again to switch off.
            Kids' titles are hidden from the normal view, so this is the only
            way to see them. */}
        <button
          type="button"
          aria-pressed={onlyKids}
          onClick={() => setOnlyKids((v) => !v)}
          className={chip(onlyKids)}
        >
          Kids
        </button>

        <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden="true" />

        <button type="button" onClick={() => setOnlyEmpty((v) => !v)} className={chip(onlyEmpty)}>
          Not downloaded · {emptyTitles}
        </button>

        <label className="ml-auto">
          <span className="sr-only">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
          >
            <option value="az">Sort: A to Z</option>
            <option value="size">Sort: biggest</option>
            <option value="bitrate">Sort: lowest bitrate</option>
          </select>
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">Nothing matches.</p>
      ) : (
        <div className="mt-5 grid grid-cols-4 gap-2 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {shown.map((g) => (
            <Tile key={g.id} group={g} onOpen={() => setSelectedId(g.id)} />
          ))}
        </div>
      )}

      <dialog
        ref={dialogRef}
        onClose={() => setSelectedId(null)}
        // Clicking the dark backdrop closes it. A click on the dialog itself has
        // the dialog as its target only when it lands outside the inner content.
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close()
        }}
        className="m-auto max-h-[85vh] w-[min(56rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-0 text-left text-foreground backdrop:bg-black/60"
      >
        {selected && <DetailPanel group={selected} onClose={() => dialogRef.current?.close()} />}
      </dialog>
    </div>
  )
}
