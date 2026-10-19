import { readFile } from "node:fs/promises"

/**
 * What the machine IS, as opposed to what it is doing right now. Read once and
 * kept: none of this changes until someone opens the case.
 */
export type Hardware = {
  /** "Intel Core i5-8350U" */
  cpuModel: string
  cores: number
  threads: number
  /** Installed memory in GB, rounded to how it is sold (see below). */
  ramGb: number
  /** "DDR4-2400" or similar; null until it has been looked up. See RAM_KIND. */
  ramKind: string | null
  /** "ThinkPad T480" */
  machine: string | null
}

/**
 * The memory TYPE is not something this container can read. The kernel only
 * exposes it through the firmware's DMI table, and that table
 * (/sys/firmware/dmi/tables/DMI) is root-only, as is `dmidecode`. Everything
 * else on this card is read live; this one fact is written down by hand once.
 *
 * Looked up by hand on 2026-10-19 with
 *   sudo dmidecode -t memory | grep -E "Size:|Type:|Speed:|Locator:"
 * which showed two sticks (8 GB in ChannelA, 16 GB in ChannelB), both DDR4 at
 * 2400 MT/s. Shown as plain "DDR4" on purpose (Matthijs's choice): the speed adds
 * nothing at a glance. Update it only if the RAM is ever swapped.
 */
const RAM_KIND: string | null = "DDR4"

// /proc/cpuinfo is bind-mounted at /host/proc; sysfs comes along with the
// recursive /:/host/root:ro mount (same trick lib/sensors.ts relies on).
const CPUINFO = "/host/proc/cpuinfo"
const MEMINFO = "/host/proc/meminfo"
const MACHINE_NAME = "/host/root/sys/class/dmi/id/product_version"

async function readText(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf-8")).trim()
  } catch {
    return null
  }
}

/** "Intel(R) Core(TM) i5-8350U CPU @ 1.70GHz" -> "Intel Core i5-8350U" */
export function cleanCpuName(raw: string): string {
  return raw
    .replace(/\((R|TM)\)/g, "")
    .replace(/\s+CPU\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * MemTotal is what the kernel can hand out, a little under what is installed
 * (firmware and the kernel itself keep a slice: this machine shows 22.9 GiB for
 * 24 GiB of sticks). RAM is sold in even sizes, so round UP to the next 2.
 */
export function installedRamGb(memTotalKb: number): number {
  const gib = memTotalKb / 1_048_576
  return Math.ceil(gib / 2) * 2
}

let cached: Hardware | null = null

export async function getHardware(): Promise<Hardware> {
  if (cached) return cached

  const [cpuinfo, meminfo, machine] = await Promise.all([
    readText(CPUINFO),
    readText(MEMINFO),
    readText(MACHINE_NAME),
  ])

  const model = cpuinfo?.match(/^model name\s*:\s*(.+)$/m)?.[1] ?? "Unknown CPU"
  const threads = (cpuinfo?.match(/^processor\s*:/gm) ?? []).length
  const cores = Number.parseInt(cpuinfo?.match(/^cpu cores\s*:\s*(\d+)/m)?.[1] ?? "", 10) || threads
  const memTotalKb = Number.parseInt(meminfo?.match(/^MemTotal:\s*(\d+)/m)?.[1] ?? "", 10)

  const hardware: Hardware = {
    cpuModel: cleanCpuName(model),
    cores,
    threads,
    ramGb: Number.isFinite(memTotalKb) ? installedRamGb(memTotalKb) : 0,
    ramKind: RAM_KIND,
    machine: machine && machine !== "Not Available" ? machine : null,
  }

  // Only cache a real answer: a failed read must not freeze "Unknown CPU" until
  // the next deploy.
  if (hardware.threads > 0 && hardware.ramGb > 0) cached = hardware
  return hardware
}
