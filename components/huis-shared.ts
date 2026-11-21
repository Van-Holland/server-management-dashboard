/** Small things the Heating and energy tabs share (added 2026-11-21). */

export const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
export const card = "rounded-2xl border border-border bg-card p-4 sm:p-5"
// Charts follow the rest of the dashboard: neutral lines, orange only as the one accent (the boiler).
export const LINE = "color-mix(in oklab, var(--foreground) 55%, transparent)"
export const FAINT = "color-mix(in oklab, var(--foreground) 28%, transparent)"
export const BOILER = "var(--usage-high, #d85a30)"
export const OUTSIDE = "#4a8fd8"

export const pad = (n: number) => String(n).padStart(2, "0")
export const clock = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(Math.round(min) % 60)}`
export const hoursText = (min: number) => `${Math.floor(min / 60)} h ${pad(Math.round(min % 60))} min`

export async function send(url: string, method: string, body: unknown): Promise<string | null> {
  try {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    if (response.ok) return null
    const data = await response.json().catch(() => ({}))
    return typeof data?.error === "string" ? data.error : "That did not work."
  } catch {
    return "The dashboard could not be reached."
  }
}

export function shortDate(date: string, weekday = true) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", weekday ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" })
}
