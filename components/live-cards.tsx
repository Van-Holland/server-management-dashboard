"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Activity, ArrowDown, ArrowUp, Download, Gauge, Loader2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { ProgressBar } from "@/components/progress-bar"
import type { DownloadsSnapshot } from "@/lib/downloads"
import type { NetworkRates } from "@/lib/network-stats"
import type { SpeedtestState } from "@/lib/speedtest"

type LiveData = {
  network: NetworkRates | null
  downloads: DownloadsSnapshot | null
  speedtest: SpeedtestState | null
}

const POLL_MS = 2000
// The POST returns as soon as the run is queued, but the card only learns it's
// running on the next poll. Keep the button disabled across that handoff so it
// can't be double-pressed.
const HANDOFF_MS = 6000

// Decimal units, matching the disk cards' GB/TB maths rather than mixing binary
// and decimal units on the same screen.
function formatSpeed(bytesPerSec: number) {
  if (bytesPerSec >= 1_000_000) return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`
  return `${Math.round(bytesPerSec / 1000)} KB/s`
}

function formatEta(seconds: number) {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${seconds}s`
}

function formatAgo(iso: string) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function CardShell({
  icon: Icon,
  title,
  subtitle,
  className,
  children,
}: {
  icon: LucideIcon
  title: string
  subtitle: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`h-full rounded-xl border border-border bg-card p-5 sm:p-6 ${className ?? ""}`}>
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  )
}

function SpeedReadout({
  direction,
  bytesPerSec,
}: {
  direction: "down" | "up"
  bytesPerSec: number | null
}) {
  const Icon = direction === "down" ? ArrowDown : ArrowUp
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{direction === "down" ? "Down" : "Up"}</p>
        <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
          {bytesPerSec === null ? "—" : formatSpeed(bytesPerSec)}
        </p>
      </div>
    </div>
  )
}

function NetworkCard({
  network,
  speedtest,
  onRunSpeedtest,
  running,
  notice,
}: {
  network: NetworkRates | null
  speedtest: SpeedtestState | null
  onRunSpeedtest: () => void
  running: boolean
  notice: string | null
}) {
  const latest = speedtest?.latest

  return (
    <CardShell
      icon={Activity}
      title="Network"
      subtitle="Bandwidth & Speed"
      className="sm:col-span-2 lg:col-span-3"
    >
      <div className="grid grid-cols-2 gap-4">
        <SpeedReadout direction="down" bytesPerSec={network?.rxBytesPerSec ?? null} />
        <SpeedReadout direction="up" bytesPerSec={network?.txBytesPerSec ?? null} />
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Gauge className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {latest ? (
              <p className="truncate font-mono text-xs tabular-nums text-foreground">
                {latest.downloadMbps}
                <span className="text-muted-foreground">↓ </span>
                {latest.uploadMbps}
                <span className="text-muted-foreground">↑ Mbps · </span>
                {latest.pingMs}
                <span className="text-muted-foreground">ms</span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">No speedtest yet</p>
            )}
          </div>

          <button
            type="button"
            onClick={onRunSpeedtest}
            disabled={running}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary/70 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
            {running ? "Testing…" : "Test"}
          </button>
        </div>

        <p className="mt-2 truncate text-xs text-muted-foreground">
          {notice ?? (latest ? `Last run ${formatAgo(latest.ranAt)}` : "Saturates the line for ~30s")}
        </p>
      </div>
    </CardShell>
  )
}

function DownloadsCard({ downloads }: { downloads: DownloadsSnapshot | null }) {
  const items = downloads?.items ?? []
  const active = items[0]
  const errors = downloads?.errors ?? []

  return (
    <CardShell
      icon={Download}
      title="Downloads"
      subtitle="Active Queue (qBittorrent + SABnzbd)"
      className="sm:col-span-2 lg:col-span-3"
    >
      {active ? (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground" title={active.name}>
                {active.name}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {active.source}
                {items.length > 1 && ` · +${items.length - 1} more`}
              </p>
            </div>
            <p className="shrink-0 font-mono text-2xl font-semibold tabular-nums text-foreground">
              {Math.round(active.progress)}
              <span className="text-base text-muted-foreground">%</span>
            </p>
          </div>

          <div className="mt-4">
            <ProgressBar pct={active.progress} label={`${active.name} progress`} />
          </div>

          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="font-mono tabular-nums text-foreground">
              {formatSpeed(downloads?.totalBytesPerSec ?? 0)}
            </span>
            <span className="text-muted-foreground">
              {downloads?.etaSeconds != null ? `${formatEta(downloads.etaSeconds)} left` : "ETA —"}
            </span>
          </div>
        </>
      ) : (
        <div className="flex min-h-[5.5rem] flex-col justify-center">
          <p className="text-sm text-muted-foreground">
            {downloads === null ? "Loading…" : "Queue idle"}
          </p>
          {downloads !== null && errors.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">Nothing downloading right now</p>
          )}
        </div>
      )}

      {errors.length > 0 && (
        <p className="mt-3 truncate text-xs text-usage-high" title={errors.join(" · ")}>
          {errors.join(" · ")}
        </p>
      )}
    </CardShell>
  )
}

// Both live cards share one poller and one request. They're returned in a
// Fragment so each card stays a direct child of the parent grid.
export function LiveCards() {
  const [data, setData] = useState<LiveData>({ network: null, downloads: null, speedtest: null })
  const [notice, setNotice] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const inFlight = useRef(false)

  useEffect(() => {
    let cancelled = false

    const fetchLive = async () => {
      // The route samples /proc for 500ms; skip rather than stacking requests
      // if one runs long.
      if (inFlight.current) return

      inFlight.current = true
      try {
        const response = await fetch("/api/live", { cache: "no-store" })
        if (!response.ok) return
        const next = (await response.json()) as LiveData
        if (!cancelled) setData(next)
      } catch {
        // Transient failure — keep the last good numbers on screen and let the
        // next tick correct them.
      } finally {
        inFlight.current = false
      }
    }

    // Recurring ticks pause while the tab is in the background — this page gets
    // left open for days and there's nothing to update when nobody's looking.
    const tick = () => {
      if (document.visibilityState === "hidden") return
      void fetchLive()
    }

    // The first load always runs, even hidden: a dashboard opened in a background
    // tab (cmd-click, restored session) must not sit on "Loading…" until focused.
    void fetchLive()

    // Coming back to the tab refreshes immediately rather than showing numbers
    // that stopped updating however long ago.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void fetchLive()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    const timer = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [])

  const runSpeedtest = useCallback(async () => {
    setNotice(null)
    setStartedAt(Date.now())
    try {
      const response = await fetch("/api/speedtest", { method: "POST" })
      const outcome = (await response.json()) as { status: string; retryAfterSeconds?: number }
      if (outcome.status === "too-soon") {
        const minutes = Math.ceil((outcome.retryAfterSeconds ?? 0) / 60)
        setNotice(`Rate limited — try again in ${minutes}m`)
        setStartedAt(null)
      }
    } catch {
      setNotice("Couldn't start the test")
      setStartedAt(null)
    }
  }, [])

  const justStarted = startedAt !== null && Date.now() - startedAt < HANDOFF_MS
  const running = Boolean(data.speedtest?.running) || justStarted

  return (
    <>
      <NetworkCard
        network={data.network}
        speedtest={data.speedtest}
        onRunSpeedtest={runSpeedtest}
        running={running}
        notice={notice ?? (data.speedtest?.error ? `Last test failed: ${data.speedtest.error}` : null)}
      />
      <DownloadsCard downloads={data.downloads} />
    </>
  )
}
