"use client"

import { useRef, type ReactNode } from "react"
import { Trash2, X } from "lucide-react"

/**
 * The recycle bin, one click away instead of a section on the page.
 *
 * The contents are rendered by the server page and passed in as children, since
 * reading the bin needs the filesystem. This component only owns the button and
 * the dialog. It stays reachable on purpose: deleting from this page is one
 * click, and the reason that is acceptable is that you can look at what is
 * still recoverable.
 */
export function RecycleBinButton({ count, children }: { count: number; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        Recycle bin{count > 0 && <span className="text-foreground"> ({count})</span>}
      </button>
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close()
        }}
        className="m-auto max-h-[85vh] w-[min(40rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-0 text-left text-foreground backdrop:bg-black/60"
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">Recycle bin</h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close"
              className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  )
}
