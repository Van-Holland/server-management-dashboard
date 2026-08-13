"use client"

import { useEffect, useState } from "react"

export function HeaderBar({ uptime }: { uptime: string }) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const time = now
    ? now.toLocaleTimeString("en-US", { hour12: false })
    : "--:--:--"
  const date = now
    ? now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : ""

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
      <div className="flex items-center gap-3">
        {/* The mark carries its own shape and transparent background, so it sits
            bare rather than inside the filled chip the generic glyph needed. */}
        <img
          src="/logo.png"
          alt=""
          aria-hidden="true"
          width={40}
          height={40}
          className="size-10 shrink-0"
        />
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">mulderserver</h1>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-status-online/15 px-2 py-0.5 text-xs font-medium text-status-online">
              <span className="size-1.5 rounded-full bg-status-online" aria-hidden="true" />
              Uptime {uptime}
            </span>
          </div>
        </div>
      </div>

      <div className="text-right">
        <p className="font-mono text-2xl font-semibold tabular-nums leading-none text-foreground">{time}</p>
        <p className="mt-1 text-xs text-muted-foreground">{date}</p>
      </div>
    </header>
  )
}
