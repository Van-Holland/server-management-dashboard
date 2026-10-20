"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Dumbbell, House, LayoutGrid, Search, ShieldCheck, type LucideIcon } from "lucide-react"
import { DAILY, FINDERS, PAGES, TOOLS, type AppEntry } from "@/lib/apps"

/**
 * Press Cmd+K (Ctrl+K elsewhere), type a few letters of an app, press Enter.
 *
 * It searches the names, the one-line descriptions and a few extra words per app
 * (lib/apps.ts), so "films" finds Jellyfin and Radarr, and "soulseek" finds slskd,
 * even though the big tiles no longer print those descriptions. External apps open
 * in a new tab like the tiles do; the dashboard's own pages open in this one.
 *
 * Mounted once in the root layout, so it works on every page. Anything can open it
 * by dispatching the "open-launcher" event (the header button does).
 */

type Item = {
  name: string
  description: string
  href: string
  logo: string | null
  tint: string | null
  icon: LucideIcon | null
  haystack: string
}

const PAGE_ICONS: Record<string, LucideIcon> = { Home: House, "Media library": LayoutGrid, Backups: ShieldCheck }

function toItem(entry: Pick<AppEntry, "name" | "description" | "href" | "keywords"> & { logo?: string | null; tint?: string }): Item {
  return {
    name: entry.name,
    description: entry.description,
    href: entry.href,
    logo: entry.logo ?? null,
    tint: entry.tint ?? null,
    icon: PAGE_ICONS[entry.name] ?? (entry.logo === null ? Dumbbell : null),
    haystack: [entry.name, entry.description, ...entry.keywords].join(" ").toLowerCase(),
  }
}

const ITEMS: Item[] = [...DAILY, ...FINDERS, ...TOOLS.flatMap((g) => g.tools), ...PAGES].map(toItem)

/** Every word typed must appear somewhere; names that start with the query come first. */
function search(query: string): Item[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ITEMS
  const scored: { item: Item; score: number }[] = []
  for (const item of ITEMS) {
    if (!words.every((w) => item.haystack.includes(w))) continue
    const name = item.name.toLowerCase()
    const score = name.startsWith(words[0]) ? 0 : name.includes(words[0]) ? 1 : 2
    scored.push({ item, score })
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.item)
}

export function Launcher() {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  // Cmd on a Mac, Ctrl on Windows and Linux (the key handler below accepts both).
  const [shortcut, setShortcut] = useState("Ctrl K")
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setShortcut("⌘ K")
  }, [])

  const results = useMemo(() => search(query), [query])

  // Open from the keyboard, or from anything that dispatches "open-launcher".
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen((v) => !v)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener("keydown", onKey)
    window.addEventListener("open-launcher", onOpen)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("open-launcher", onOpen)
    }
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      setQuery("")
      setActive(0)
      dialog.showModal()
      inputRef.current?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Keep the highlighted row on screen when arrowing through a long list.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" })
  }, [active])

  function go(item: Item | undefined) {
    if (!item) return
    setOpen(false)
    if (item.href.startsWith("/")) router.push(item.href)
    else window.open(item.href, "_blank", "noopener,noreferrer")
  }

  function onInputKey(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      go(results[active])
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={() => setOpen(false)}
      onClick={(event) => {
        if (event.target === dialogRef.current) setOpen(false)
      }}
      className="launcher"
      aria-label="Open an app or page"
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onInputKey}
          placeholder={`Open an app or page  ·  ${shortcut}`}
          aria-label="Open an app or page"
          role="combobox"
          aria-expanded="true"
          aria-controls="launcher-list"
          aria-activedescendant={results[active] ? `launcher-${active}` : undefined}
          className="w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <kbd className="hidden shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground sm:block">esc</kbd>
      </div>

      {results.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</p>
      ) : (
        <ul id="launcher-list" ref={listRef} role="listbox" className="max-h-[22rem] overflow-y-auto p-2">
          {results.map((item, index) => {
            const Icon = item.icon
            return (
              <li
                key={item.name}
                id={`launcher-${index}`}
                role="option"
                aria-selected={index === active}
                onPointerMove={() => setActive(index)}
                onClick={() => go(item)}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                  index === active ? "bg-secondary" : ""
                }`}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
                  {item.logo ? (
                    <img src={`/logos/${item.logo}.svg`} alt="" width={20} height={20} className="size-5 object-contain" />
                  ) : Icon ? (
                    <Icon className="size-[18px] text-muted-foreground" style={item.tint ? { color: item.tint } : undefined} aria-hidden="true" />
                  ) : null}
                </span>
                <span className="text-sm font-medium text-foreground">{item.name}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{item.description}</span>
              </li>
            )
          })}
        </ul>
      )}
    </dialog>
  )
}
