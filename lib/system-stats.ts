import { readFile, statfs } from "node:fs/promises"

export type DiskStats = { usedGb: number; totalGb: number }

export type SystemStats = {
  ssd: DiskStats
  hdd: DiskStats
  cpu: number
  ram: number
  uptime: string
}

// Uses Node's built-in statfs syscall wrapper instead of shelling out to `df` —
// no dependency on which df variant (GNU vs BusyBox) happens to be on the base image.
export async function getDiskStats(path: string): Promise<DiskStats> {
  const stats = await statfs(path)
  const totalBytes = stats.blocks * stats.bsize
  const usedBytes = (stats.blocks - stats.bfree) * stats.bsize
  return {
    usedGb: Math.round(usedBytes / 1_000_000_000),
    totalGb: Math.round(totalBytes / 1_000_000_000),
  }
}

// /proc/stat's first line: cpu  user nice system idle iowait irq softirq steal guest guest_nice
export type CpuSample = { idle: number; total: number }

export async function sampleCpu(): Promise<CpuSample> {
  const raw = await readFile("/host/proc/stat", "utf-8")
  const parts = raw.split("\n")[0].trim().split(/\s+/).slice(1).map(Number)
  const idle = parts[3] + parts[4] // idle + iowait
  const total = parts.reduce((sum, value) => sum + value, 0)
  return { idle, total }
}

// CPU usage % = 1 - (idle time delta / total time delta) between two samples.
export function cpuRate(first: CpuSample, second: CpuSample): number {
  const idleDelta = second.idle - first.idle
  const totalDelta = second.total - first.total
  if (totalDelta <= 0) return 0
  return Math.round(100 * (1 - idleDelta / totalDelta))
}

export async function getRamStats(): Promise<number> {
  const raw = await readFile("/host/proc/meminfo", "utf-8")
  const values: Record<string, number> = {}
  for (const line of raw.split("\n")) {
    const [key, value] = line.split(":")
    if (key && value) values[key.trim()] = Number.parseInt(value.trim(), 10)
  }
  const total = values["MemTotal"]
  const available = values["MemAvailable"]
  const usedPct = 100 * (1 - available / total)
  return Math.round(usedPct)
}

// /proc/uptime's first number is seconds since boot.
export async function getUptime(): Promise<string> {
  const raw = await readFile("/host/proc/uptime", "utf-8")
  const totalSeconds = Math.floor(Number.parseFloat(raw.split(" ")[0]))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  return `${days}d ${hours}h`
}

// Used by the server render and /api/stats. Keeps a short CPU sample window of
// its own so first paint isn't held up — the live poll uses the longer shared
// window in lib/sampler.ts instead.
const FIRST_PAINT_CPU_SAMPLE_MS = 200

export async function getSystemStats(): Promise<SystemStats> {
  const cpuFirst = await sampleCpu()
  const [ssd, hdd, ram, uptime] = await Promise.all([
    getDiskStats("/host/root"),
    getDiskStats("/host/storage8tb"),
    getRamStats(),
    getUptime(),
  ])
  await new Promise((resolve) => setTimeout(resolve, FIRST_PAINT_CPU_SAMPLE_MS))
  const cpu = cpuRate(cpuFirst, await sampleCpu())

  return { ssd, hdd, cpu, ram, uptime }
}
