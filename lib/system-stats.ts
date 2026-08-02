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
async function getDiskStats(path: string): Promise<DiskStats> {
  const stats = await statfs(path)
  const totalBytes = stats.blocks * stats.bsize
  const usedBytes = (stats.blocks - stats.bfree) * stats.bsize
  return {
    usedGb: Math.round(usedBytes / 1_000_000_000),
    totalGb: Math.round(totalBytes / 1_000_000_000),
  }
}

// /proc/stat's first line: cpu  user nice system idle iowait irq softirq steal guest guest_nice
// CPU usage % = 1 - (idle time delta / total time delta) between two samples taken slightly apart.
async function getCpuStats(): Promise<number> {
  const readCpuLine = async () => {
    const raw = await readFile("/host/proc/stat", "utf-8")
    const parts = raw.split("\n")[0].trim().split(/\s+/).slice(1).map(Number)
    const idle = parts[3] + parts[4] // idle + iowait
    const total = parts.reduce((sum, value) => sum + value, 0)
    return { idle, total }
  }

  const first = await readCpuLine()
  await new Promise((resolve) => setTimeout(resolve, 200))
  const second = await readCpuLine()

  const idleDelta = second.idle - first.idle
  const totalDelta = second.total - first.total
  const usedPct = totalDelta === 0 ? 0 : 100 * (1 - idleDelta / totalDelta)
  return Math.round(usedPct)
}

async function getRamStats(): Promise<number> {
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
async function getUptime(): Promise<string> {
  const raw = await readFile("/host/proc/uptime", "utf-8")
  const totalSeconds = Math.floor(Number.parseFloat(raw.split(" ")[0]))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  return `${days}d ${hours}h`
}

export async function getSystemStats(): Promise<SystemStats> {
  const [ssd, hdd, cpu, ram, uptime] = await Promise.all([
    getDiskStats("/host/root"),
    getDiskStats("/host/storage8tb"),
    getCpuStats(),
    getRamStats(),
    getUptime(),
  ])
  return { ssd, hdd, cpu, ram, uptime }
}
