import { readFile } from "node:fs/promises"
import { evaluateSmart, type SmartJson } from "@/lib/health-probe"

/**
 * Drive health for the home page (added 2026-10-22): a one-word verdict for the System tile and the numbers for the two drive cards.
 *
 * A root job on the server writes each drive's SMART report to /var/lib/mulderserver-health every hour (see health-probe.ts, which
 * turns the same files into Health warnings). The verdict here is built from those same warnings, so the tile, the cards and the Health
 * page cannot disagree.
 */

const HOST = "/host/root"
const SMART_HDD = `${HOST}/var/lib/mulderserver-health/smart-hdd.json`
const SMART_NVME = `${HOST}/var/lib/mulderserver-health/smart-nvme.json`

export type DriveHealth = {
  /** unix seconds of the SMART reading; the file is rewritten hourly */
  checkedAtSec: number | null
  passed: boolean | null
  tempC: number | null
  poweredOnHours: number | null
  /** SSD only */
  wearPct: number | null
  sparePct: number | null
  mediaErrors: number | null
  /** 8TB drive only: reallocated + pending + uncorrectable sectors */
  badSectors: number | null
}

export type DriveHealthSnapshot = {
  ssd: DriveHealth | null
  hdd: DriveHealth | null
  /** the worst thing either drive's warnings say; "ok" means nothing to report */
  status: "ok" | "warn" | "alert" | "unknown"
  /** short plain words for the System tile when status is not ok, e.g. "Check HDD" */
  problem: string | null
}

async function readJson(path: string): Promise<SmartJson | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as SmartJson
  } catch {
    return null
  }
}

function hdd(s: SmartJson): DriveHealth {
  const attrs = s.ata_smart_attributes?.table ?? []
  const raw = (id: number) => attrs.find((a) => a.id === id)?.raw.value ?? 0
  return {
    checkedAtSec: s.local_time?.time_t ?? null,
    passed: s.smart_status?.passed ?? null,
    tempC: s.temperature?.current ?? null,
    poweredOnHours: s.power_on_time?.hours ?? null,
    wearPct: null,
    sparePct: null,
    mediaErrors: null,
    badSectors: raw(5) + raw(197) + raw(198),
  }
}

function ssd(s: SmartJson): DriveHealth {
  const n = s.nvme_smart_health_information_log as (NonNullable<SmartJson["nvme_smart_health_information_log"]> & { power_on_hours?: number }) | undefined
  return {
    checkedAtSec: s.local_time?.time_t ?? null,
    passed: s.smart_status?.passed ?? null,
    tempC: n?.temperature ?? s.temperature?.current ?? null,
    poweredOnHours: n?.power_on_hours ?? s.power_on_time?.hours ?? null,
    wearPct: n?.percentage_used ?? null,
    sparePct: n?.available_spare ?? null,
    mediaErrors: n?.media_errors ?? null,
    badSectors: null,
  }
}

export async function getDriveHealth(): Promise<DriveHealthSnapshot> {
  const [h, n] = await Promise.all([readJson(SMART_HDD), readJson(SMART_NVME)])
  if (!h && !n) return { ssd: null, hdd: null, status: "unknown", problem: null }
  const now = Date.now()
  const warnings = [...(h ? evaluateSmart("hdd", h, now) : []), ...(n ? evaluateSmart("nvme", n, now) : [])]
  const worst = warnings.some((w) => w.level === "alert") ? "alert" : warnings.length > 0 ? "warn" : "ok"
  // name the first drive with a problem, alerts first
  const first = [...warnings].sort((a) => (a.level === "alert" ? -1 : 1))[0]
  const which = first ? (first.id.includes("-hdd") ? "HDD" : "SSD") : null
  const problem = !first ? null : first.id.endsWith("-stale") ? "Reading is old" : worst === "alert" ? `${which} failing` : `Check ${which}`
  return { ssd: n ? ssd(n) : null, hdd: h ? hdd(h) : null, status: worst, problem }
}
