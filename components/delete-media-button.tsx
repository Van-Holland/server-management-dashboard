"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Trash2 } from "lucide-react"
import type { DeleteTarget, DeleteStep } from "@/lib/media-delete"

/**
 * The only interactive part of an otherwise server-rendered page.
 *
 * Built on the native <dialog> element rather than a modal library, for the
 * same reason GroupBlock is built on <details>: the platform already provides
 * focus trapping, Escape-to-close and the backdrop, and this repo has exactly
 * one shadcn component installed. Adding a dialog dependency to ask "are you
 * sure" would be the largest change in the feature.
 *
 * One click to confirm, by decision — the recycle bin keeps every deleted file
 * for 7 days, so the cost of a wrong click is a restore rather than a
 * re-download. The dialog still spells out exactly what is about to go: that is
 * information, not friction, and it is the part that makes the single click
 * defensible.
 */

type Props = {
  target: DeleteTarget
  /** What the user sees named in the dialog, e.g. "Silo — S01E04". */
  title: string
  /** The one-line consequence, e.g. "1 file · 4.2 GB". */
  detail: string
  /**
   * True for a whole film or series, where the entry itself is removed and not
   * just its files. Drives the extra sentence in the dialog — the difference
   * between "the file goes" and "the show disappears from Sonarr entirely" is
   * the thing most worth not discovering afterwards.
   */
  removesEntry: boolean
  /** Sizing for the icon: rows are tighter than group headers. */
  size?: "sm" | "md"
}

export function DeleteMediaButton({ target, title, detail, removesEntry, size = "md" }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ summary: string; steps: DeleteStep[] } | null>(null)

  function open(event: React.MouseEvent) {
    // This button sits inside a <summary> and inside a table row. Without both
    // of these, clicking it also toggles the disclosure it lives in — the
    // dialog opens behind a group that just collapsed underneath it.
    event.preventDefault()
    event.stopPropagation()
    setFailure(null)
    dialogRef.current?.showModal()
  }

  async function confirm() {
    setBusy(true)
    setFailure(null)
    try {
      const res = await fetch("/api/media/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      })
      const result = (await res.json()) as { ok: boolean; summary: string; steps: DeleteStep[] }
      if (!result.ok) {
        // Kept on screen rather than closed-and-toasted. A half-completed
        // delete is precisely the case where the individual steps matter:
        // "files gone, unmonitor failed" means it comes back tonight.
        setFailure({ summary: result.summary, steps: result.steps })
        return
      }
      dialogRef.current?.close()
      router.refresh()
    } catch (err) {
      setFailure({
        summary: err instanceof Error ? err.message : "The request never completed",
        steps: [],
      })
    } finally {
      setBusy(false)
    }
  }

  const iconSize = size === "sm" ? "size-3.5" : "size-4"

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={`Delete ${title}`}
        title={`Delete ${title}`}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-usage-high/10 hover:text-usage-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-usage-high/40"
      >
        <Trash2 className={iconSize} aria-hidden="true" />
      </button>

      <dialog
        ref={dialogRef}
        // The backdrop is styled in globals.css — ::backdrop cannot be reached
        // from a Tailwind utility on the element itself.
        className="max-w-md rounded-xl border border-border bg-card p-0 text-foreground backdrop:bg-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <p className="text-sm font-medium text-foreground">Delete {title}?</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>

          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {removesEntry ? (
              <li>
                The entry is removed from {target.kind === "movie" ? "Radarr" : "Sonarr"} entirely and
                its Jellyseerr record cleared, so it can be requested again like new.
              </li>
            ) : (
              <li>
                The files go and monitoring is switched off, so the nightly sweep will not download
                them again. The show itself stays.
              </li>
            )}
            <li>
              Files move to <span className="font-mono">/downloads/.recyclebin</span> and are
              recoverable for 7 days.
            </li>
            <li>Jellyfin is told automatically by {target.kind === "movie" ? "Radarr" : "Sonarr"}.</li>
          </ul>

          {failure && (
            <div className="mt-3 rounded-lg border border-usage-high/40 p-3">
              <p className="text-xs font-medium text-usage-high">{failure.summary}</p>
              <ul className="mt-1.5 space-y-0.5">
                {failure.steps.map((s, i) => (
                  <li key={`${s.step}-${i}`} className="font-mono text-[0.7rem] text-muted-foreground">
                    {s.step}: {s.status} — {s.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-usage-high px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
