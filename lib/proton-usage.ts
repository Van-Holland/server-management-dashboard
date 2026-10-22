import { readFile } from "node:fs/promises"
import type { HealthWarning } from "@/lib/health"

/**
 * How full the Proton Drive account is (added 2026-10-22).
 *
 * `/home/matt/scripts/proton-usage.sh` asks rclone once an hour and writes the answer to a small file. If a run fails the old file stays,
 * so the dashboard can show the last known number with its age. The total is the whole Proton plan, so it includes mail and anything else
 * on the account, not only Drive files: that is the real limit, so that is the number shown.
 */

const FILE = process.env.PROTON_USAGE_FILE ?? "/host/root/home/matt/proton-usage.json"
const STALE_MS = 6 * 60 * 60 * 1000
const WARN_PCT = 80
const ALERT_PCT = 90

export type ProtonUsage = { checkedAtIso: string; totalBytes: number; usedBytes: number }

export async function getProtonUsage(): Promise<ProtonUsage | null> {
  try {
    const u = JSON.parse(await readFile(FILE, "utf-8")) as ProtonUsage
    return u.totalBytes > 0 && u.usedBytes >= 0 ? u : null
  } catch {
    return null
  }
}

export const protonPct = (u: ProtonUsage) => Math.round((100 * u.usedBytes) / u.totalBytes)

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`

export function evaluateProtonUsage(u: ProtonUsage | null, nowMs: number): HealthWarning[] {
  if (!u) {
    return [{ id: "proton-usage-missing", level: "maintenance", title: "Proton storage use is not being read", detail: "No file from proton-usage.sh. Check its cron job on mulderserver (hourly, at :40)." }]
  }
  const out: HealthWarning[] = []
  const pct = protonPct(u)
  const left = `${gb(u.totalBytes - u.usedBytes)} left of ${gb(u.totalBytes)}`
  if (pct >= ALERT_PCT) {
    out.push({ id: "proton-full", level: "alert", title: `Proton Drive is almost full (${pct}%)`, detail: `${left}. Uploads will start to fail. Free up space or upgrade the plan.` })
  } else if (pct >= WARN_PCT) {
    out.push({ id: "proton-full", level: "maintenance", title: `Proton Drive is ${pct}% full`, detail: `${left}. Plan to free up space or upgrade before the backups no longer fit.` })
  }
  if (nowMs - Date.parse(u.checkedAtIso) > STALE_MS) {
    out.push({ id: "proton-usage-stale", level: "maintenance", title: "Proton storage use is out of date", detail: `Last read ${Math.round((nowMs - Date.parse(u.checkedAtIso)) / 3600000)} hours ago. Check proton-usage.sh on mulderserver.` })
  }
  return out
}
