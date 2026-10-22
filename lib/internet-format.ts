/**
 * Text helpers and shared types for the internet watcher. No server-only imports in here: the Network tile (a browser
 * component) uses them too. Reading the files is lib/internet-watch.ts.
 */

const TZ = "Europe/Amsterdam"

export type OutageWhere = "modem" | "line" | "beyond" | "unknown"
export type Outage = { start: number; end: number; secs: number; where: OutageWhere; note?: string }

/** What the Network tile needs. */
export type InternetSummary = {
  state: "up" | "down" | "stale"
  downSinceIso: string | null
  lastOutage: Outage | null
  outages7d: number
}

export function formatDuration(secs: number): string {
  if (secs < 60) return `${Math.max(0, Math.round(secs))} s`
  const min = Math.round(secs / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export function whenMs(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ })
}

export function dayMs(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: TZ })
}

export function whereText(where: OutageWhere): string {
  switch (where) {
    case "modem":
      return "Your modem or router did not answer."
    case "line":
      return "The modem answered, but Ziggo's gateway did not: the line or Ziggo's network."
    case "beyond":
      return "Ziggo's gateway answered, but the wider internet did not: further out on the internet."
    default:
      return "Not known (from older logs, or the watcher was not running)."
  }
}

export function whereShort(where: OutageWhere): string {
  return where === "modem" ? "Your modem" : where === "line" ? "Line or Ziggo" : where === "beyond" ? "Further out" : "Unknown"
}

