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
  const date = now
    ? now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
    : ""

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex items-center gap-4">
        {/* The mark carries its own shape and transparent background, so it sits bare. */}
        <img
          src="/logo.png"
          alt=""
          aria-hidden="true"
          width={48}
          height={48}
          className="size-12 shrink-0"
        />
        <div>
          {/* The one serif on the page: the name of the machine. */}
          <h1 className="font-display text-4xl leading-none tracking-tight text-foreground">mulderserver</h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            {/* Breathing: the server is alive. It says "up", not "all is well",
                because uptime is all this line actually knows. */}
            <span
              className="breathe size-1.5 rounded-full bg-status-online text-status-online"
              aria-hidden="true"
            />
            Up {uptime}
          </p>
        </div>
      </div>

      <div className="flex w-full flex-col items-start gap-3 sm:w-auto sm:items-end">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("open-launcher"))}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="size-3.5" aria-hidden="true" />
          Open anything
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[11px] leading-none">{shortcut}</kbd>
        </button>
        <div className="text-left sm:text-right">
        <p className="text-2xl font-normal tabular-nums leading-none tracking-wide text-foreground">{time}</p>
        <p className="mt-1.5 text-sm text-muted-foreground">{date}</p>
        </div>
      </div>
    </header>
  )
}
