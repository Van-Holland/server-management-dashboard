"use client"

import { useMemo, useRef, useState, type CSSProperties } from "react"
import Link from "next/link"
import { ChevronRight, Dumbbell, Search, X } from "lucide-react"
import { DAILY, FINDERS, TOOLS, type AppEntry } from "@/lib/apps"

/**
 * The "All apps" button and its popup (added 2026-11-21, replaces the old Tools list at the bottom of the home page).
 *
 * One window with every app under a heading per category, like the app library on an iPad: Apps, Finders, then the
 * groups from lib/apps.ts (Knowledge, Household, Utilities, System, Arr stack, Downloaders). A search box on top narrows
 * it by name, description or the extra words per app, the same words the Cmd+K launcher uses. Native <dialog> and the same
 * open/close animation as the Finders folder (globals.css, `dialog.finders`), so Esc, focus and screen readers come for free.
 */

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

type Section = { title: string; apps: AppEntry[] }

const SECTIONS: Section[] = [
  { title: "Apps", apps: DAILY },
  { title: "Finders", apps: FINDERS },
  ...TOOLS.map((group) => ({ title: group.title, apps: group.tools })),
]

function matches(app: AppEntry, words: string[]) {
  if (words.length === 0) return true
  const haystack = [app.name, app.description, ...app.keywords].join(" ").toLowerCase()
  return words.every((word) => haystack.includes(word))
}

function AppTile({ app }: { app: AppEntry }) {
  const className = `app group flex w-full flex-col items-center gap-2 rounded-2xl p-1 ${focusRing}`
  const style = { "--tint": app.tint } as CSSProperties
  const inner = (
    <>
      <span className="app-icon flex size-14 items-center justify-center rounded-[18px]">
        {app.logo ? (
          <img src={`/logos/${app.logo}.svg`} alt="" width={32} height={32} className="logo-img size-8 object-contain" />
        ) : (
          <Dumbbell className="logo-img size-7" style={{ color: app.tint }} aria-hidden="true" />
        )}
      </span>
      <span className="app-name text-center text-xs font-medium leading-tight">{app.name}</span>
    </>
  )
  // A page of this dashboard (href starts with "/") opens in the same tab; everything else is another app and opens in a new one.
  if (app.href.startsWith("/")) {
    return (
      <Link href={app.href} title={app.description} style={style} className={className}>
        {inner}
      </Link>
    )
  }
  return (
    <a href={app.href} target="_blank" rel="noopener noreferrer" title={app.description} style={style} className={className}>
      {inner}
    </a>
  )
}

export function AllApps() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [closing, setClosing] = useState(false)
  const [query, setQuery] = useState("")

  const words = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query])
  const visible = useMemo(
    () => SECTIONS.map((s) => ({ ...s, apps: s.apps.filter((a) => matches(a, words)) })).filter((s) => s.apps.length > 0),
    [words],
  )

  function open() {
    const dialog = dialogRef.current
    const button = buttonRef.current
    if (!dialog || !button || dialog.open) return
    // Where the button sits relative to the middle of the screen, so the window can grow out of it.
    const r = button.getBoundingClientRect()
    dialog.style.setProperty("--dx", `${r.left + r.width / 2 - window.innerWidth / 2}px`)
    dialog.style.setProperty("--dy", `${r.top + r.height / 2 - window.innerHeight / 2}px`)
    setQuery("")
    setClosing(false)
    dialog.showModal()
    // On a phone, focusing the search box would pop the keyboard up over the apps; only do it with a mouse or trackpad.
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus()
  }

  function close() {
    const dialog = dialogRef.current
    if (!dialog || !dialog.open || closing) return
    setClosing(true)
    // Let the shrink-back play, then really close. (200 ms, the same as the CSS.)
    window.setTimeout(() => {
      dialog.close()
      setClosing(false)
      buttonRef.current?.focus()
    }, 200)
  }

  return (
    <>
      {/* The section title is the button (design D, 2026-11-21): "Apps ›". It opens the window below. */}
      <h2 id="daily-heading" className="text-sm font-medium">
        <button
          ref={buttonRef}
          type="button"
          onClick={open}
          aria-haspopup="dialog"
          className="group inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Apps
          <ChevronRight
            className="size-4 text-muted-foreground transition-transform duration-300 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>
      </h2>

      <dialog
        ref={dialogRef}
        className="finders allapps"
        data-closing={closing || undefined}
        aria-labelledby="allapps-title"
        onCancel={(event) => {
          // Esc: play the shrink-back instead of vanishing.
          event.preventDefault()
          close()
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) close()
        }}
      >
        <div className="flex items-center gap-3 px-6 pt-6">
          <h2 id="allapps-title" className="text-lg font-semibold text-foreground">
            All apps
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className={`ml-auto flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${focusRing}`}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-6 pt-3">
          <label className="flex items-center gap-2 rounded-xl border border-border bg-background/60 px-3 py-2">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search apps"
              aria-label="Search apps"
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </label>
        </div>

        <div className="allapps-body px-6 pb-6 pt-1">
          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</p>
          ) : (
            visible.map((section, n) => (
              <section key={section.title} className="finders-item pt-5" style={{ "--n": n } as CSSProperties}>
                <h3 className="mb-3 text-xs font-medium text-muted-foreground">{section.title}</h3>
                <div className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-5">
                  {section.apps.map((app) => (
                    <AppTile key={app.name} app={app} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </dialog>
    </>
  )
}
