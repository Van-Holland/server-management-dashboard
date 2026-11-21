"use client"

import { useRef, useState } from "react"
import { BOILER, clock, FAINT, hoursText, OUTSIDE, pad } from "@/components/huis-shared"
import { SCHEDULE_POINTS, SCHEDULE_START_TARGET } from "@/lib/huis-config"
import type { DayDetail, DayStat, HuisSnapshot } from "@/lib/huis-types"

/**
 * The Today tab: one chart with the target (dashed), the room (solid), the outside temperature (blue), yesterday's room (faint)
 * and a strip showing when the boiler fired. Point at it (or touch it) to read the exact numbers for that minute.
 */

const W = 640
const LEFT = 34
const RIGHT = 10
const span = W - LEFT - RIGHT
const x = (min: number) => LEFT + (min / 1440) * span

function targetAt(day: DayDetail, min: number): number | null {
  let t: number | null = null
  for (const p of day.points) {
    if (p.min > min) break
    if (p.target !== null) t = p.target
  }
  return t
}
function roomAt(day: DayDetail, min: number): number | null {
  let t: number | null = null
  for (const p of day.points) {
    if (p.min > min) break
    if (p.room !== null) t = p.room
  }
  return t
}
function outsideAt(day: DayDetail, min: number): number | null {
  let t: number | null = null
  for (const p of day.outside) {
    if (p.min > min) break
    t = p.t
  }
  return t
}
const onAt = (day: DayDetail, min: number) => day.boiler.some((b) => min >= b.from && min <= b.to)

function path(points: { min: number; v: number | null }[], y: (v: number) => number, stepped = false): string {
  let d = ""
  let prev: number | null = null
  for (const p of points) {
    if (p.v === null) continue
    const px = x(p.min).toFixed(1)
    if (!d) d = `M${px},${y(p.v).toFixed(1)}`
    else if (stepped && prev !== null) d += ` L${px},${y(prev).toFixed(1)} L${px},${y(p.v).toFixed(1)}`
    else d += ` L${px},${y(p.v).toFixed(1)}`
    prev = p.v
  }
  return d
}

export function TodayTab({ snapshot }: { snapshot: HuisSnapshot }) {
  const { day, yesterday, days, outsideNow } = snapshot
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const temps = [...day.points.map((p) => p.room), ...day.outside.map((p) => p.t), ...(yesterday?.points.map((p) => p.room) ?? [])].filter((v): v is number => v !== null)
  const lo = Math.floor(Math.min(14, ...temps) - 1)
  const hi = Math.ceil(Math.max(22, ...temps) + 1)
  const top = 14
  const chartH = 140
  const y = (t: number) => top + (1 - (t - lo) / (hi - lo)) * chartH
  const stripY = top + chartH + 14
  const bottom = stripY + 38

  // Today's target as a step line from the program for the hours that have no history yet, then the real targets.
  const programPath = path(
    [{ min: 0, v: SCHEDULE_START_TARGET }, ...SCHEDULE_POINTS.map((p) => ({ min: p.at, v: p.target })), { min: 1440, v: SCHEDULE_POINTS[SCHEDULE_POINTS.length - 1].target }],
    y,
    true,
  )
  const roomPath = path(day.points.map((p) => ({ min: p.min, v: p.room })), y)
  const targetPath = path(day.points.map((p) => ({ min: p.min, v: p.target })), y, true)
  const outsidePath = path([...day.outside.map((p) => ({ min: p.min, v: p.t })), ...(day.outside.length ? [{ min: day.nowMin, v: day.outside[day.outside.length - 1].t }] : [])], y, true)
  const yPath = yesterday ? path(yesterday.points.map((p) => ({ min: p.min, v: p.room })), y) : ""

  function move(event: { clientX: number }) {
    const box = svgRef.current?.getBoundingClientRect()
    if (!box) return
    const px = ((event.clientX - box.left) / box.width) * W
    const min = ((px - LEFT) / span) * 1440
    setHover(min < 0 || min > 1440 ? null : Math.round(min))
  }

  const today = days[days.length - 1]
  const yest = days[days.length - 2]
  const read = hover !== null && hover <= day.nowMin ? hover : null
  const roomNow = roomAt(day, day.nowMin)
  const warm = [...days].reverse().find((d) => d.warmupMin !== null)

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Chip label="Room" value={roomNow !== null ? `${roomNow.toFixed(1)}°` : "—"} />
        <Chip label="Outside" value={outsideNow !== null ? `${outsideNow.toFixed(1)}°` : "—"} note={outsideNow === null ? "no data yet" : undefined} />
        <Chip label="Boiler today" value={today ? hoursText(today.boilerMin) : "—"} note={today && yest ? `yesterday ${hoursText(yest.boilerMin)} in total` : undefined} />
        <Chip label="Warm-up" value={warm?.warmupMin != null ? hoursText(warm.warmupMin) : "—"} note={warm?.warmupMin != null ? `to ${warm.warmupTarget}°, ${warm === today ? "today" : "on " + warm.date.slice(5)}` : "target rise 3° or more"} />
      </div>

      <p className="mt-4 min-h-5 text-xs text-muted-foreground" aria-live="polite">
        {read !== null ? (
          <>
            {clock(read)} · room {roomAt(day, read)?.toFixed(1) ?? "—"}° · target {targetAt(day, read) ?? "—"}° · outside {outsideAt(day, read)?.toFixed(1) ?? "—"}° · boiler {onAt(day, read) ? "on" : "off"}
          </>
        ) : (
          "Point at the chart for the exact numbers."
        )}
      </p>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${bottom}`}
        className="mt-1 h-auto w-full touch-none"
        role="img"
        aria-label="Today: target, room and outside temperature, and when the boiler fired"
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setHover(null)}
      >
        {[5, 10, 15, 20, 25].filter((t) => t > lo && t < hi).map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={W - RIGHT} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={0.6} />
            <text x={LEFT - 5} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">{t}°</text>
          </g>
        ))}
        <path d={programPath} fill="none" stroke={FAINT} strokeWidth={1} strokeDasharray="2 4" />
        {yPath ? <path d={yPath} fill="none" stroke={FAINT} strokeWidth={1.4} /> : null}
        {outsidePath ? <path d={outsidePath} fill="none" stroke={OUTSIDE} strokeWidth={1.4} opacity={0.85} /> : null}
        {targetPath ? <path d={targetPath} fill="none" stroke="var(--muted-foreground)" strokeWidth={1.4} strokeDasharray="5 4" /> : null}
        {roomPath ? <path d={roomPath} fill="none" stroke="var(--foreground)" strokeWidth={2} strokeLinejoin="round" /> : null}

        <text x={LEFT - 5} y={stripY + 9} textAnchor="end" fontSize="10" fill="var(--muted-foreground)">Boiler</text>
        <rect x={LEFT} y={stripY} width={span} height={12} rx={3} fill="var(--secondary)" />
        {day.boiler.map((b) => (
          <rect key={b.from} x={x(b.from)} y={stripY} width={Math.max(2, x(b.to) - x(b.from))} height={12} rx={2} fill={BOILER} />
        ))}
        {[0, 6, 12, 18, 24].map((h) => (
          <text key={h} x={x(h * 60)} y={stripY + 30} textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"} fontSize="10" fill="var(--muted-foreground)">{pad(h)}</text>
        ))}
        <line x1={x(day.nowMin)} x2={x(day.nowMin)} y1={top - 4} y2={stripY + 12} stroke="var(--foreground)" strokeWidth={1.2} />
        {read !== null ? <line x1={x(read)} x2={x(read)} y1={top - 4} y2={stripY + 12} stroke="var(--muted-foreground)" strokeWidth={0.8} /> : null}
      </svg>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Key color="var(--foreground)" label="Room" />
        <Key color="var(--muted-foreground)" label="Target" dashed />
        <Key color={OUTSIDE} label="Outside" />
        <Key color={FAINT} label="Yesterday's room" />
        <Key color={BOILER} label="Boiler on" box />
      </ul>
      <Compare today={today} yesterday={yest} />
    </div>
  )
}

function Compare({ today, yesterday }: { today?: DayStat; yesterday?: DayStat }) {
  if (!today || !yesterday) return null
  // Compare the same time of day: yesterday's boiler minutes up to the hour it is now.
  const hour = new Date().getHours()
  const same = yesterday.hourMin.slice(0, hour + 1).reduce((s, m) => s + m, 0)
  const diff = today.boilerMin - same
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      Same time yesterday the boiler had run {hoursText(same)}; today {hoursText(today.boilerMin)}
      {diff === 0 ? "." : diff > 0 ? `, ${Math.abs(diff)} min more.` : `, ${Math.abs(diff)} min less.`}
      {today.outsideAvg !== null && yesterday.outsideAvg !== null ? ` Outside averages ${today.outsideAvg.toFixed(1)}° today and ${yesterday.outsideAvg.toFixed(1)}° yesterday.` : ""}
    </p>
  )
}

function Chip({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl bg-secondary px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-medium text-foreground">{value}</p>
      {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  )
}

function Key({ color, label, dashed, box }: { color: string; label: string; dashed?: boolean; box?: boolean }) {
  return (
    <li className="flex items-center gap-1.5">
      <svg width="16" height="8" aria-hidden="true">
        {box ? <rect x="0" y="0" width="16" height="8" rx="2" fill={color} /> : <line x1="0" x2="16" y1="4" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} />}
      </svg>
      {label}
    </li>
  )
}

