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
      {/* Mark and text block are the same height (44px) and centred on each other. */}
      <div className="flex min-w-0 items-center gap-3">
        <img src="/logo.png" alt="" aria-hidden="true" width={44} height={44} className="size-11 shrink-0" />
        <div className="min-w-0">
          <h1
            className="truncate text-xl leading-none tracking-tight text-foreground sm:text-[22px]"
            style={{ fontFamily: "var(--font-name), var(--font-sans)", fontWeight: 500 }}
          >
            Mulderserver
          </h1>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs leading-none text-muted-foreground">
            {/* Breathing: the server is alive. It says "up", not "all is well",
                because uptime is all this line actually knows. */}
            <span
              className="breathe size-1.5 shrink-0 rounded-full bg-status-online text-status-online"
              aria-hidden="true"
            />
            <span className="truncate">
              Up {uptime}
              {/* Phone: the clock moves up here so the right side is just the search icon. */}
              <span className="tabular-nums sm:hidden"> · {shortDate}, {shortTime}</span>
            </span>
          </p>
        </div>
      </div>

      {/* Search sits left of the clock; the clock is flush with the right edge. */}
      <div className="flex shrink-0 items-center gap-4 sm:gap-5">
        <button
          type="button"
          onClick={openLauncher}
          aria-label={`Search (${shortcut})`}
          title={`Search · ${shortcut}`}
          className="inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-9"
        >
          <Search className="size-[18px]" aria-hidden="true" />
        </button>
        <div className="hidden text-right sm:block">
          <p className="text-lg font-normal tabular-nums leading-none text-foreground">{time}</p>
          <p className="mt-1.5 text-xs leading-none text-muted-foreground">{date}</p>
        </div>
      </div>
    </header>
  )
}
