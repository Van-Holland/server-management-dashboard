"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BatteryWarning,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Cpu,
  Database,
  Download,
  Fan,
  Gauge,
  HardDrive,
  Loader2,
  Plug,
  Thermometer,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { ProgressBar, usageColor } from "@/components/progress-bar"
import type { DiskIo, DiskIoRates } from "@/lib/disk-io"
import type { DownloadsSnapshot } from "@/lib/downloads"
import type { NetworkRates } from "@/lib/network-stats"
import type { Sensors } from "@/lib/sensors"
import type { SpeedtestState } from "@/lib/speedtest"
import type { Hardware } from "@/lib/hardware"
import type { DiskStats } from "@/lib/system-stats"

type Capacity = { ssd: DiskStats; hdd: DiskStats; ram: number; uptime: string }

type LiveData = {
  rates: { cpu: number; network: NetworkRates; diskIo: DiskIoRates } | null
  capacity: Capacity | null
  sensors: Sensors | null
  downloads: DownloadsSnapshot | null
  speedtest: SpeedtestState | null
}

export type InitialStats = { ssd: DiskStats; hdd: DiskStats; cpu: number; ram: number; hardware: Hardware }

const POLL_MS = 2000
// The POST returns as soon as the run is queued, but the card only learns it's
// running on the next poll. Keep the button disabled across that handoff.
const HANDOFF_MS = 6000

// Decimal units, matching the disk cards' GB/TB maths rather than mixing binary
// and decimal units on the same screen.
function formatSpeed(bytesPerSec: number) {
  if (bytesPerSec >= 1_000_000) return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`
  return `${Math.round(bytesPerSec / 1000)} KB/s`
}

function formatSize(gb: number) {
  if (gb >= 1000) return `${(gb / 1000).toFixed(2)} TB`
  return `${gb} GB`
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

// Warm/hot thresholds differ per sensor: an NVMe drive throttles around 70 °C,
// while this CPU idles in the 50s and is fine into the 70s under load.
function tempColor(celsius: number, warm: number, hot: number) {
  if (celsius >= hot) return "text-usage-high"
  if (celsius >= warm) return "text-usage-mid"
  return "text-muted-foreground"
}

function batteryColor(percent: number) {
  if (percent < 20) return "text-usage-high"
  if (percent < 50) return "text-usage-mid"
  return "text-muted-foreground"
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
    <div className={`panel h-full rounded-2xl p-5 sm:p-6 ${className ?? ""}`}>
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

function DiskCard({
  label,
  disk,
  io,
  tempC,
  icon: Icon,
  link,
}: {
  label: string
  disk: DiskStats
  io: DiskIo | null
  tempC: number | null
  icon: LucideIcon
  /**
   * Optional link out to a detail page. Deliberately a small button rather than
   * making the whole card clickable: this card's job is still disk usage, and
   * wrapping it in an anchor would turn every stray click on the capacity bar
   * into a navigation.
   */
  link?: { href: string; label: string }
}) {
  const pct = Math.min(100, Math.round((disk.usedGb / disk.totalGb) * 100))
  return (
    <div className="panel h-full rounded-2xl p-5 sm:p-6 lg:col-span-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{label}</p>
            <p className="truncate text-xs text-muted-foreground">
              {formatSize(disk.usedGb)} <span className="opacity-60">/</span>{" "}
              {formatSize(disk.totalGb)}
            </p>
          </div>
        </div>
        <p className="shrink-0 font-mono text-2xl font-semibold tabular-nums text-foreground">
          {pct}
          <span className="text-base text-muted-foreground">%</span>
        </p>
      </div>

      <div className="mt-5">
        <ProgressBar pct={pct} label={`${label} usage`} color={usageColor(pct)} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-mono tabular-nums text-muted-foreground">
          {io ? (
            <>
              R <span className="text-foreground">{formatSpeed(io.readBytesPerSec)}</span>
              <span className="px-1.5 opacity-40">·</span>W{" "}
              <span className="text-foreground">{formatSpeed(io.writeBytesPerSec)}</span>
            </>
          ) : (
            "R — · W —"
          )}
        </span>
        {/* Only the NVMe drive reports a temperature; the 8TB is a USB enclosure. */}
        {tempC !== null && (
          <span className={`shrink-0 font-mono tabular-nums ${tempColor(tempC, 50, 65)}`}>
            {tempC}°C
          </span>
        )}
      </div>

      {link && (
        <Link
          href={link.href}
          className="mt-4 inline-flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
        >
          {link.label}
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  )
}

function MetricRow({ label, pct, detail }: { label: string; pct: number; detail?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">{pct}%</span>
      </div>
      {detail && <p className="mb-2 truncate text-xs text-foreground">{detail}</p>}
      <ProgressBar pct={pct} label={`${label} usage`} color={usageColor(pct)} />
    </div>
  )
}

/**
 * One card for the machine itself: what it is (CPU model, RAM), how hard it is
 * working (load), and whether it is happy (temperature, fan, mains power).
 * This used to be two cards, System and Health, side by side.
 */
function SystemCard({
  cpu,
  ram,
  hardware,
  sensors,
}: {
  cpu: number
  ram: number
  hardware: Hardware
  sensors: Sensors | null
}) {
  const cpuTemp = sensors?.cpuTempC ?? null
  const fanRpm = sensors?.fanRpm ?? null
  const power = sensors?.power
  const onBattery = power?.onAc === false

  const ramDetail = hardware.ramGb > 0 ? [`${hardware.ramGb} GB`, hardware.ramKind].filter(Boolean).join(" ") : undefined

  return (
    <CardShell
      icon={Cpu}
      title="System"
      subtitle={hardware.machine ?? "Load, temperature and power"}
      className="lg:col-span-2 lg:row-span-2"
    >
      <div className="flex flex-col gap-5">
        <MetricRow label="CPU" pct={cpu} detail={hardware.cpuModel} />
        <MetricRow label="RAM" pct={ram} detail={ramDetail} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-5">
        <div className="flex items-center gap-2">
          <Thermometer className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">CPU temp</p>
            <p
              className={`font-mono text-lg font-semibold tabular-nums ${
                cpuTemp === null ? "text-foreground" : tempColor(cpuTemp, 65, 80)
              }`}
            >
              {cpuTemp === null ? "—" : `${cpuTemp}°C`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Fan className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Fan</p>
            <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
              {fanRpm === null ? "—" : `${fanRpm}`}
              {fanRpm !== null && <span className="text-xs text-muted-foreground"> rpm</span>}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {onBattery ? (
              <BatteryWarning className="size-4 shrink-0 text-usage-high" aria-hidden="true" />
            ) : (
              <Plug className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <p
              className={`truncate text-xs font-medium ${
                onBattery ? "text-usage-high" : "text-muted-foreground"
              }`}
            >
              {power?.onAc === null || power === undefined
                ? "Power unknown"
                : onBattery
                  ? "ON BATTERY — mains lost"
                  : "AC connected"}
            </p>
          </div>

          <p className="shrink-0 font-mono text-xs tabular-nums">
            {power && power.batteries.length > 0 ? (
              power.batteries.map((battery, index) => (
                <span key={battery.name}>
                  {index > 0 && <span className="px-1 opacity-40">·</span>}
                  <span className={batteryColor(battery.percent)}>{battery.percent}%</span>
                </span>
              ))
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </p>
        </div>
      </div>
    </CardShell>
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
      className="sm:col-span-2 lg:col-span-2"
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
                <span className="text-muted-foreground">↑ · </span>
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
      subtitle="Active Queue (qBittorrent + SABnzbd + slskd)"
      className="sm:col-span-2 lg:col-span-2"
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

// Every card shares one poller and one request. They're returned in a Fragment
// so each card stays a direct child of the parent grid.
/**
 * One small cell of the always-visible server row. The full cards (disk I/O,
 * speedtest, the download queue, fan and battery) still exist; they live behind
 * "All server details" so they stop taking the top of the page.
 */
/** How many 2-second samples a sparkline remembers: about a minute. */
const HISTORY_LENGTH = 30

type History = { cpu: number[]; rx: number[]; dl: number[] }

function pushSample(list: number[], value: number | undefined): number[] {
  if (value === undefined) return list
  return [...list, value].slice(-HISTORY_LENGTH)
}

/**
 * A tiny line of the last minute. Scaled to its own highest value but never below
 * `floor`, so a quiet machine draws a low flat line instead of exaggerating noise.
 * Colour is a CSS colour token string, so one component serves every cell.
 */
function Sparkline({ values, floor, stroke, label }: { values: number[]; floor: number; stroke: string; label: string }) {
  const max = Math.max(floor, ...values)
  const points =
    values.length < 2
      ? "0,23 100,23"
      : values
          .map((v, i) => `${((i * 100) / (values.length - 1)).toFixed(1)},${(23 - (v / max) * 20).toFixed(1)}`)
          .join(" ")
  return (
    <svg viewBox="0 0 100 26" preserveAspectRatio="none" className="h-6 w-full" role="img" aria-label={label}>
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function SummaryCell({
  label,
  value,
  pct,
  color,
  valueClass = "text-foreground",
  index,
  spark,
}: {
  label: string
  value: string
  pct?: number | null
  color?: string
  valueClass?: string
  /** Position in the entrance sequence (apps come first, then these). */
  index: number
  /** A sparkline shown instead of a bar. */
  spark?: React.ReactNode
}) {
  return (
    <div className="panel enter rounded-[14px] p-4" style={{ "--i": index } as React.CSSProperties}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-medium tabular-nums sm:truncate ${valueClass}`}>{value}</p>
      {/* Fixed height so every cell lines up, whatever it shows underneath. */}
      <div className="mt-2 flex h-6 items-end">
        {spark ?? (pct !== null && pct !== undefined && (
          <div className="w-full pb-0.5">
            <ProgressBar pct={pct} label={`${label} level`} color={color} size="sm" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ServerSummary({
  cpu,
  ssd,
  hdd,
  data,
  history,
}: {
  cpu: number
  ssd: DiskStats
  hdd: DiskStats
  data: LiveData
  history: History
}) {
  const percent = (disk: DiskStats) => (disk.totalGb > 0 ? Math.round((100 * disk.usedGb) / disk.totalGb) : 0)
  const ssdPct = percent(ssd)
  const hddPct = percent(hdd)
  const fullest = Math.max(ssdPct, hddPct)

  const cpuTemp = data.sensors?.cpuTempC ?? null
  const onBattery = data.sensors?.power.onAc === false
  const systemValue = onBattery
    ? "On battery, mains lost"
    : `${cpu}% CPU${cpuTemp === null ? "" : `, ${cpuTemp}°C`}`
  const systemHot = onBattery || (cpuTemp !== null && cpuTemp >= 80)

  const network = data.rates?.network ?? null
  const downloads = data.downloads
  const active = downloads?.items ?? []

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <SummaryCell
        index={5}
        label="System"
        value={systemValue}
        valueClass={systemHot ? "text-usage-high" : "text-foreground"}
        spark={
          <Sparkline
            values={history.cpu}
            floor={10}
            label="CPU load over the last minute"
            stroke={cpu > 85 ? "var(--usage-high)" : cpu >= 60 ? "var(--usage-mid)" : "var(--usage-low)"}
          />
        }
      />
      <SummaryCell
        index={6}
        label="Storage"
        value={`HDD ${hddPct}%, SSD ${ssdPct}%`}
        pct={fullest}
        color={usageColor(fullest)}
      />
      <SummaryCell
        index={7}
        label="Network"
        value={network ? `${formatSpeed(network.rxBytesPerSec)} down` : "—"}
        spark={
          <Sparkline values={history.rx} floor={100_000} label="Download speed over the last minute" stroke="color-mix(in oklab, var(--foreground) 55%, transparent)" />
        }
      />
      <SummaryCell
        index={8}
        label="Downloads"
        value={
          downloads === null
            ? "—"
            : active.length === 0
              ? "Idle"
              : `${active.length} active, ${formatSpeed(downloads.totalBytesPerSec)}`
        }
        spark={
          <Sparkline values={history.dl} floor={1_000_000} label="Download queue speed over the last minute" stroke="color-mix(in oklab, var(--foreground) 55%, transparent)" />
        }
      />
    </div>
  )
}

export function LiveCards({ initial, children }: { initial: InitialStats; children?: React.ReactNode }) {
  const [data, setData] = useState<LiveData>({
    rates: null,
    capacity: null,
    sensors: null,
    downloads: null,
    speedtest: null,
  })
  const [notice, setNotice] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  // Open swaps the slim summary row for the full cards. Showing both would print
  // every number twice.
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<History>({ cpu: [], rx: [], dl: [] })
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
        if (!cancelled) {
          setData(next)
          setHistory((h) => ({
            cpu: pushSample(h.cpu, next.rates?.cpu),
            rx: pushSample(h.rx, next.rates?.network.rxBytesPerSec),
            dl: pushSample(h.dl, next.downloads?.totalBytesPerSec),
          }))
        }
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
    // tab (cmd-click, restored session) must not sit on stale numbers until focused.
    void fetchLive()

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

  // Until the first poll lands, fall back to the server-rendered values so the
  // cards that used to paint instantly still do.
  const ssd = data.capacity?.ssd ?? initial.ssd
  const hdd = data.capacity?.hdd ?? initial.hdd
  const cpu = data.rates?.cpu ?? initial.cpu
  const ram = data.capacity?.ram ?? initial.ram

  return (
    <section aria-labelledby="server-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="server-heading" className="text-sm font-medium text-muted-foreground">
          Server
        </h2>
        {/* Stays in the same place in both states, so it does not jump when the
            content below changes. */}
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-controls="server-details"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? (
            <>
              Show less
              <ChevronUp className="size-4" aria-hidden="true" />
            </>
          ) : (
            <>
              All details
              <ChevronDown className="size-4" aria-hidden="true" />
            </>
          )}
        </button>
      </div>

      {/* Both are always in the page. Opening slides the summary away and the full
          cards in, so nothing jumps; `inert` keeps the hidden one out of tab order. */}
      <div className="disclosure" data-open={!expanded} inert={expanded}>
        <div>
          <ServerSummary cpu={cpu} ssd={ssd} hdd={hdd} data={data} history={history} />
        </div>
      </div>
      <div id="server-details" className="disclosure" data-open={expanded} inert={!expanded}>
        <div>
          <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <DiskCard
              label="SSD"
              disk={ssd}
              io={data.rates?.diskIo.ssd ?? null}
              tempC={data.sensors?.ssdTempC ?? null}
              icon={HardDrive}
            />
            <DiskCard
              label="HDD"
              disk={hdd}
              io={data.rates?.diskIo.hdd ?? null}
              tempC={null}
              icon={Database}
              // Only the 8TB gets this — it holds the media library. The SSD holds
              // configs and databases, which /media has nothing to say about.
              link={{ href: "/media", label: "Media" }}
            />
            <SystemCard cpu={cpu} ram={ram} hardware={initial.hardware} sensors={data.sensors} />
            <NetworkCard
              network={data.rates?.network ?? null}
              speedtest={data.speedtest}
              onRunSpeedtest={runSpeedtest}
              running={running}
              notice={notice ?? (data.speedtest?.error ? `Last test failed: ${data.speedtest.error}` : null)}
            />
            <DownloadsCard downloads={data.downloads} />
          </div>
        </div>
      </div>
      {children}
    </section>
  )
}
