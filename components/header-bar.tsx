"use client"

import { useEffect, useState } from "react"
import { Search } from "lucide-react"

export function HeaderBar({ uptime }: { uptime: string }) {
  const [now, setNow] = useState<Date | null>(null)
  const [shortcut, setShortcut] = useState("Ctrl K")
  const [showUptime, setShowUptime] = useState(false)

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

  const openLauncher = () => window.dispatchEvent(new Event("open-launcher"))

  return (
    <header className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <img src="/logo.png" alt="" aria-hidden="true" width={44} height={44} className="size-11 shrink-0" />
        {/* The name alone, on the mark's centre line. Uptime lives in the dot's
            tooltip and in the System card, not in a second line here. */}
        <h1
          className="truncate text-2xl leading-none tracking-tight text-foreground"
          style={{ fontFamily: "var(--font-name), var(--font-sans)", fontWeight: 400 }}
        >
          Mulderserver
        </h1>
        <span className="group relative -ml-1.5">
          {/* Breathing: the server is alive. Hover (computer) or tap (phone) shows
              the uptime. It says "up", not "all is well", because uptime is all
              this dot actually knows. */}
          <button
            type="button"
            onClick={() => setShowUptime((v) => !v)}
            onBlur={() => setShowUptime(false)}
            aria-label={`Online. Up ${uptime}`}
            className="flex size-6 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="breathe size-2 rounded-full bg-status-online text-status-online" aria-hidden="true" />
          </button>
          <span
            role="status"
            className={`pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground shadow-lg transition-opacity group-hover:opacity-100 ${
              showUptime ? "opacity-100" : "opacity-0"
            }`}
          >
            Up {uptime}
          </span>
        </span>
      </div>

      {/* Search sits left of the clock; the clock is flush with the right edge. */}
      <div className="flex shrink-0 items-center gap-3 sm:gap-5">
        <button
          type="button"
          onClick={openLauncher}
          aria-label={`Search (${shortcut})`}
          title={`Search · ${shortcut}`}
          className="inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-9"
        >
          <Search className="size-[18px]" aria-hidden="true" />
        </button>
        {/* Phone: just the time. Larger screens: seconds and the full date. */}
        <p className="text-base tabular-nums text-foreground sm:hidden">{shortTime}</p>
        <div className="hidden text-right sm:block">
          <p className="text-lg font-normal tabular-nums leading-none text-foreground">{time}</p>
          <p className="mt-1.5 text-xs leading-none text-muted-foreground">{date}</p>
        </div>
      </div>
    </header>
  )
}
