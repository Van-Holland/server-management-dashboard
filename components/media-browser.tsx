"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { Film, Search, Tv, X } from "lucide-react"
import { formatBytes, formatMbps, formatRuntime } from "@/lib/media-format"
import type { MediaFile, MediaGroup } from "@/lib/media"
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
    <span className={`rounded-md px-1.5 py-0.5 text-[0.7rem] font-medium leading-none ${className}`}>
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
      className="group overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
    >
      <div className="relative aspect-[2/3] bg-secondary">
        <div className={`h-full w-full ${empty ? "opacity-40" : ""}`}>
          <Poster group={group} />
        </div>
        {quality && (
          <span className="absolute left-2 top-2">
            <Badge className="bg-black/70 text-white">{quality}</Badge>
          </span>
        )}
        {(thin > 0 || group.missingCount > 0) && (
          <span className="absolute bottom-2 left-2 flex flex-col items-start gap-1">
            {thin > 0 && (
              <Badge className="bg-usage-mid text-black">{isSeries ? `${thin} thin` : "thin"}</Badge>
            )}
            {group.missingCount > 0 && (
              <Badge className="bg-usage-high text-white">
                {isSeries && !empty ? `${group.missingCount} missing` : "missing"}
              </Badge>
            )}
          </span>
        )}
      </div>
      <div className="px-2.5 py-2">
        <p className="truncate text-sm font-medium text-foreground">{group.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {empty
            ? "Not downloaded"
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

function FileTable({ group }: { group: MediaGroup }) {
  const bySeason = new Map<number, MediaFile[]>()
  for (const f of group.files) {
    // Files arrive sorted by label ("S01E01"…), so insertion order is season order.
    const n = f.seasonNumber ?? -1
    const bucket = bySeason.get(n)
    if (bucket) bucket.push(f)
    else bySeason.set(n, [f])
  }

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
            : [...bySeason.entries()].map(([seasonNumber, files]) => {
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
                        <DeleteMediaButton
                          size="sm"
                          target={{ kind: "season", id: group.arrId, seasonNumber }}
                          title={`${group.title} — ${seasonLabel(seasonNumber)}`}
                          detail={`${files.length} file${files.length === 1 ? "" : "s"} · ${formatBytes(seasonBytes)}`}
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
                          // lacks either gets no button rather than one that fails.
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
          // Without this the dialog focuses its first button, which is the
          // delete icon — a red ring around the most dangerous control.
          autoFocus
          aria-label="Close"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {group.files.length > 0 && (
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
  const [onlyThin, setOnlyThin] = useState(false)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [sort, setSort] = useState<SortKey>("az")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const thinTitles = groups.filter((g) => thinCount(g) > 0).length
  const missingTitles = groups.filter((g) => g.missingCount > 0).length

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = groups.filter(
      (g) =>
        (kind === "all" || g.kind === kind) &&
        (!onlyThin || thinCount(g) > 0) &&
        (!onlyMissing || g.missingCount > 0) &&
        (q === "" || g.title.toLowerCase().includes(q)),
    )
    if (sort === "size") list.sort((a, b) => b.totalBytes - a.totalBytes || a.title.localeCompare(b.title))
    else if (sort === "bitrate") list.sort((a, b) => lowestBitrate(a) - lowestBitrate(b) || a.title.localeCompare(b.title))
    else list.sort((a, b) => a.title.localeCompare(b.title))
    return list
  }, [groups, query, kind, onlyThin, onlyMissing, sort])

  // After a delete the server re-renders without the title; the panel must
  // close rather than keep showing something that no longer exists.
  const selected = groups.find((g) => g.id === selectedId) ?? null

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (selected && !dialog.open) dialog.showModal()
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

        <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden="true" />

        <button type="button" onClick={() => setOnlyThin((v) => !v)} className={chip(onlyThin)}>
          Thin · {thinTitles}
        </button>
        <button type="button" onClick={() => setOnlyMissing((v) => !v)} className={chip(onlyMissing)}>
          Missing · {missingTitles}
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
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
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
