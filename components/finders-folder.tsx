"use client"

import { useRef, useState, type CSSProperties } from "react"
import { X } from "lucide-react"
import { AmbientTrigger } from "@/components/ambient-trigger"
import { FINDERS } from "@/lib/apps"

/**
 * The "Finders" folder (added 2026-10-20): an icon like a phone's home-screen folder, with the three apps for getting new things
 * (Jellyseerr, Lidarr, slskd) as tiny logos inside it. A tap opens a popup that grows out of the icon, with the page behind it
 * blurred and the three apps floating in one after another. On a phone it slides up from the bottom. Native <dialog>, like the
 * Cmd+K launcher, so Esc, focus handling and screen readers come for free. "Reduce motion" turns every animation off (globals.css).
 */

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

export function FindersFolder({ index }: { index: number }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const tileRef = useRef<HTMLButtonElement>(null)
  const [closing, setClosing] = useState(false)

  function open() {
    const dialog = dialogRef.current
    const tile = tileRef.current
    if (!dialog || !tile || dialog.open) return
    // Where the icon sits relative to the middle of the screen, so the popup can grow out of it.
    const r = tile.getBoundingClientRect()
    dialog.style.setProperty("--dx", `${r.left + r.width / 2 - window.innerWidth / 2}px`)
    dialog.style.setProperty("--dy", `${r.top + r.height / 2 - window.innerHeight / 2}px`)
    setClosing(false)
    dialog.showModal()
  }

  function close() {
    const dialog = dialogRef.current
    if (!dialog || !dialog.open || closing) return
    setClosing(true)
    // Let the shrink-back play, then really close. (200 ms, the same as the CSS.)
    window.setTimeout(() => {
      dialog.close()
      setClosing(false)
      tileRef.current?.focus()
    }, 200)
  }

  return (
    <>
      <button
        ref={tileRef}
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        title="Finders: get new films, shows and music"
        style={{ "--tint": "#7c6cf0", "--i": index } as CSSProperties}
        className={`app enter group flex w-full max-w-[8.5rem] flex-col items-center gap-3 rounded-3xl p-1 ${focusRing}`}
      >
        <AmbientTrigger />
        <span className="app-icon relative flex size-[4.75rem] items-center justify-center rounded-[22px] sm:size-24 sm:rounded-[26px]">
          {/* Three tiny logos in a two-by-two grid, like the preview on a phone folder. */}
          <span className="grid grid-cols-2 gap-1.5 sm:gap-2" aria-hidden="true">
            {FINDERS.map((f) => (
              <span key={f.name} className="flex size-[1.65rem] items-center justify-center rounded-lg bg-secondary/70 sm:size-8">
                <img src={`/logos/${f.logo}.svg`} alt="" width={20} height={20} className="size-4 object-contain sm:size-5" />
              </span>
            ))}
          </span>
        </span>
        <span className="app-name text-center text-sm font-medium leading-tight tracking-tight sm:text-[15px]">Finders</span>
      </button>

      <dialog
        ref={dialogRef}
        className="finders"
        data-closing={closing || undefined}
        aria-labelledby="finders-title"
        onCancel={(event) => {
          // Esc: play the shrink-back instead of vanishing.
          event.preventDefault()
          close()
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) close()
        }}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <h2 id="finders-title" className="text-lg font-semibold text-foreground">
              Finders
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Get something new into the library.</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className={`flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${focusRing}`}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <ul className="space-y-1 p-3 pb-5">
          {FINDERS.map((f, n) => (
            <li key={f.name} className="finders-item" style={{ "--n": n } as CSSProperties}>
              <a
                href={f.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ "--tint": f.tint } as CSSProperties}
                className={`app flex items-center gap-4 rounded-2xl px-3 py-2.5 transition-colors hover:bg-secondary/60 ${focusRing}`}
              >
                <span className="app-icon flex size-14 shrink-0 items-center justify-center rounded-[18px]">
                  <img src={`/logos/${f.logo}.svg`} alt="" width={32} height={32} className="logo-img size-8 object-contain" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium text-foreground">{f.name}</span>
                  <span className="block text-sm text-muted-foreground">{f.description}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  )
}
