import { readFile } from "node:fs/promises"
import type { HealthWarning } from "@/lib/health"
import { formatDuration, whenMs, whereShort, whereText, type InternetSummary, type Outage, type OutageWhere } from "./internet-format"

/**
 * The internet watcher (added 2026-10-22).
 *
 * A small job on the server (`/home/matt/scripts/internet-watch.py`, every minute) tests three things: the modem, Ziggo's
 * first gateway, and the wider internet. It keeps a status file for "now" and a list of finished outages. This module only
 * reads those two files and turns them into words, a "when do outages happen" grid, a summary to show Ziggo, and the
 * warnings for the Health system.
 *
 * Why it exists: on 22 Oct the home internet was down for 1 h 40 min at night, the nightly backups to Proton were skipped,
 * and nothing had recorded when or where the connection broke.
 */

const DIR = process.env.INTERNET_WATCH_DIR ?? "/host/root/home/matt/internet-watch"
const STATUS_FILE = `${DIR}/status.json`
const OUTAGES_FILE = `${DIR}/outages.jsonl`

const STALE_MS = 5 * 60 * 1000
const DOWN_ALERT_MS = 5 * 60 * 1000
const RECENT_MS = 24 * 60 * 60 * 1000
const MIN_SECS_TO_REPORT = 5 * 60
const OFTEN = 3
const KEEP_DAYS = 90
const TZ = "Europe/Amsterdam"

export type WatchStatus = {
  updatedAtIso: string
  watchingSinceIso: string
  down: boolean
  downSinceIso: string | null
  now: { modem: boolean; gateway: boolean; internet: boolean; rttMs: number | null }
  lastOutage: Outage | null
  outages24h: number
  outages7d: number
  outages30d: number
  downSecs7d: number
  downSecs30d: number
  uptimePct30d: number
}

export type InternetWatch = { status: WatchStatus; outages: Outage[] }

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T
  } catch {
    return null
  }
}

export async function getInternetWatch(): Promise<InternetWatch | null> {
  const status = await readJson<WatchStatus>(STATUS_FILE)
  if (!status) return null
  let outages: Outage[] = []
  try {
    const text = await readFile(OUTAGES_FILE, "utf-8")
    outages = text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Outage)
      .filter((o) => Date.now() / 1000 - o.end < KEEP_DAYS * 86400)
      .sort((a, b) => a.start - b.start)
  } catch {
    // no outage yet, or the file is not there: an empty list is the honest answer
  }
  return { status, outages }
}

export function summarize(w: InternetWatch | null, nowMs: number): InternetSummary | null {
  if (!w) return null
  const stale = nowMs - Date.parse(w.status.updatedAtIso) > STALE_MS
  return {
    state: stale ? "stale" : w.status.down ? "down" : "up",
    downSinceIso: w.status.downSinceIso,
    lastOutage: w.outages[w.outages.length - 1] ?? null,
    outages7d: w.outages.filter((o) => nowMs / 1000 - o.end < 7 * 86400).length,
  }
}

export async function getInternetSummary(): Promise<InternetSummary | null> {
  return summarize(await getInternetWatch(), Date.now())
}

// ---------- health ----------

const warn = (id: string, title: string, detail: string, level: HealthWarning["level"]): HealthWarning => ({ id, title, detail, level })

export function evaluateInternet(w: InternetWatch | null, nowMs: number): HealthWarning[] {
  if (!w) {
    return [
      warn(
        "internet-watch-missing",
        "The internet watcher has no data yet",
        "No status file from internet-watch.py. Check the cron job on mulderserver (every minute).",
        "maintenance",
      ),
    ]
  }
  const out: HealthWarning[] = []
  const s = w.status
  const ageMs = nowMs - Date.parse(s.updatedAtIso)
  if (!Number.isFinite(ageMs) || ageMs > STALE_MS) {
    out.push(warn("internet-watch-stale", "The internet watcher has stopped", `It last reported ${whenMs(Date.parse(s.updatedAtIso))}. Check the cron job internet-watch.py on mulderserver (every minute).`, "alert"))
    return out
  }
  const downSince = s.downSinceIso ? Date.parse(s.downSinceIso) : Number.NaN
  if (s.down && Number.isFinite(downSince) && nowMs - downSince >= DOWN_ALERT_MS) {
    const where = !s.now.modem ? "modem" : !s.now.gateway ? "line" : "beyond"
    out.push(warn("internet-down", "The internet is down", `Since ${whenMs(downSince)}. Right now: ${whereText(where)} See the Internet history.`, "alert"))
  }
  const last = w.outages[w.outages.length - 1]
  if (last && !s.down && last.secs >= MIN_SECS_TO_REPORT && nowMs - last.end * 1000 < RECENT_MS) {
    out.push(
      warn(
        "internet-outage-recent",
        `The internet was down for ${formatDuration(last.secs)}`,
        `${whenMs(last.start * 1000)} to ${whenMs(last.end * 1000)}. ${whereText(last.where)} Scheduled jobs that need the internet (Proton backups) may have been skipped. See the Internet history.`,
        "maintenance",
      ),
    )
  }
  if (s.outages7d >= OFTEN) {
    out.push(
      warn(
        "internet-outages-often",
        `${s.outages7d} internet outages in the last 7 days`,
        `${formatDuration(s.downSecs7d)} in total. The Internet history lists each one, with the times to show Ziggo.`,
        "maintenance",
      ),
    )
  }
  return out
}

// ---------- the "when do outages happen" grid ----------

export type HourGrid = { days: { key: string; label: string }[]; cells: number[][] }

/** Seconds of outage in each hour of each of the last `days` days, local (Amsterdam) time. Oldest day first. */
export function hourGrid(outages: Outage[], nowMs: number, days = 14): HourGrid {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
  const parts = (ms: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
    return { key: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) }
  }
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) keys.push(parts(nowMs - i * 86400000).key)
  const index = new Map(keys.map((k, i) => [k, i]))
  const cells = keys.map(() => Array.from({ length: 24 }, () => 0))
  for (const o of outages) {
    for (let t = o.start * 1000; t < o.end * 1000; t += 60000) {
      const { key, hour } = parts(t)
      const row = index.get(key)
      if (row !== undefined) cells[row][hour] += Math.min(60, (o.end * 1000 - t) / 1000)
    }
  }
  const label = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
  return { days: keys.map((k) => ({ key: k, label: label(k) })), cells }
}

// ---------- the summary to show Ziggo ----------

const DUTCH_WHERE: Record<OutageWhere, string> = {
  modem: "modem reageerde niet",
  line: "modem reageerde wel, de gateway van Ziggo (84.30.136.1) niet",
  beyond: "gateway van Ziggo reageerde wel, het internet daarachter niet",
  unknown: "onbekend",
}

/** Plain Dutch text with every outage and its times, to paste into a message to Ziggo. Only what was measured. */
export function ziggoSummary(w: InternetWatch, nowMs: number): string {
  const t = (ms: number) => new Date(ms).toLocaleString("nl-NL", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ })
  const hm = (ms: number) => new Date(ms).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: TZ })
  const lines = [
    "Internetstoringen, gemeten met een meetscript op mijn eigen server (elke minuut wordt gecontroleerd of de modem, de eerste gateway van Ziggo en het internet bereikbaar zijn).",
    `Meting gestart: ${t(Date.parse(w.status.watchingSinceIso))}. Overzicht gemaakt: ${t(nowMs)}.`,
    "",
  ]
  if (w.outages.length === 0) lines.push("Tot nu toe zijn er geen storingen van meer dan 2 minuten gemeten.")
  for (const o of [...w.outages].reverse()) {
    const approx = o.note && /approximate/i.test(o.note) ? " (ongeveer, uit oudere logs)" : ""
    lines.push(`- ${t(o.start * 1000)} tot ${hm(o.end * 1000)}, ${formatDuration(o.secs)}${approx}: ${DUTCH_WHERE[o.where]}`)
  }
  return lines.join("\n")
}
