"use client"

import { useEffect, useState } from "react"
import { Search } from "lucide-react"

export function HeaderBar({ uptime }: { uptime: string }) {
  const [now, setNow] = useState<Date | null>(null)
  const [shortcut, setShortcut] = useState("Ctrl K")

  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setShortcut("⌘ K")
  }, [])

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const time = now ? now.toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--"
  const shortTime = time.slice(0, 5)
  const date = now
    ? now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
    : ""
  const shortDate = now
    ? now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    : ""

  const openLauncher = () => window.dispatchEvent(new Event("open-launcher"))

  return (
    <header className="flex items-center justify-between gap-4">
      {/* The mark and the two text lines share one height (h-11), centred on each
          other, so the mark is no longer taller than the name beside it. */}
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <img
          src="/logo.png"
          alt=""
          aria-hidden="true"
          width={44}
          height={44}
          className="size-11 shrink-0 sm:size-12"
        />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold leading-none tracking-tight text-foreground sm:text-3xl">
            Mulderserver
          </h1>
          <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
            {/* Breathing: the server is alive. It says "up", not "all is well",
                because uptime is all this line actually knows. */}
            <span
              className="breathe size-1.5 shrink-0 rounded-full bg-status-online text-status-online"
              aria-hidden="true"
            />
            <span className="truncate">
              Up {uptime}
              {/* Phone: the clock moves up here so the right side is just the search button. */}
              <span className="sm:hidden tabular-nums"> · {shortDate}, {shortTime}</span>
            </span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-5">
        <div className="hidden text-right sm:block">
          <p className="text-xl font-normal tabular-nums leading-none tracking-wide text-foreground">{time}</p>
          <p className="mt-1.5 text-sm leading-none text-muted-foreground">{date}</p>
        </div>
        <button
          type="button"
          onClick={openLauncher}
          aria-label="Open anything"
          className="inline-flex size-11 items-center justify-center gap-2 rounded-xl border border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-auto sm:rounded-lg sm:px-3 sm:text-sm"
        >
          <Search className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Open anything</span>
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[11px] leading-none sm:inline">{shortcut}</kbd>
        </button>
      </div>
    </header>
  )
}
