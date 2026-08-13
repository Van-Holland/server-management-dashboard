import { readFile } from "node:fs/promises"

export type DiskIo = { readBytesPerSec: number; writeBytesPerSec: number }
export type DiskIoRates = { ssd: DiskIo | null; hdd: DiskIo | null }

const DISKSTATS_PATH = "/host/proc/diskstats"
// Host-namespace mount table, for the same reason network-stats reads /proc/1/net.
const MOUNTS_PATH = "/host/proc/1/mounts"
const HDD_MOUNTPOINT = "/mnt/storage8tb"

// /proc/diskstats fields, 0-indexed after splitting:
// 0 major | 1 minor | 2 name | 3 reads done | 4 reads merged | 5 sectors read
// 6 ms reading | 7 writes done | 8 writes merged | 9 sectors written | ...
const SECTORS_READ = 5
const SECTORS_WRITTEN = 9
// The kernel always reports diskstats sectors as 512 bytes, regardless of the
// device's real logical block size.
const SECTOR_BYTES = 512

export type DiskSample = Map<string, { read: number; write: number }>

export async function sampleDiskstats(): Promise<DiskSample> {
  const raw = await readFile(DISKSTATS_PATH, "utf-8")
  const sample: DiskSample = new Map()

  for (const line of raw.split("\n")) {
    const fields = line.trim().split(/\s+/)
    if (fields.length <= SECTORS_WRITTEN) continue
    sample.set(fields[2], {
      read: Number(fields[SECTORS_READ]) * SECTOR_BYTES,
      write: Number(fields[SECTORS_WRITTEN]) * SECTOR_BYTES,
    })
  }

  return sample
}

// A partition maps back to its whole disk: sda1 -> sda, nvme0n1p3 -> nvme0n1.
function toWholeDisk(device: string): string {
  const nvme = device.match(/^(nvme\d+n\d+)p\d+$/)
  if (nvme) return nvme[1]
  return device.replace(/\d+$/, "")
}

// USB enumeration order is not stable — the 8TB drive came back as /dev/sda1
// having been /dev/sdb1 across the 2026-08-07 reboot. So the HDD is resolved
// through its mount point rather than hardcoded, the same reasoning that put a
// UUID in the host's fstab. The SSD is the machine's only NVMe device.
let cachedDevices: { ssd: string | null; hdd: string | null } | null = null

async function resolveDevices(sample: DiskSample): Promise<{
  ssd: string | null
  hdd: string | null
}> {
  if (cachedDevices) return cachedDevices

  let ssd: string | null = null
  for (const name of sample.keys()) {
    if (/^nvme\d+n\d+$/.test(name)) {
      ssd = name
      break
    }
  }

  let hdd: string | null = null
  try {
    const mounts = await readFile(MOUNTS_PATH, "utf-8")
    for (const line of mounts.split("\n")) {
      const [device, mountPoint] = line.split(/\s+/)
      if (mountPoint !== HDD_MOUNTPOINT || !device?.startsWith("/dev/")) continue
      const candidate = toWholeDisk(device.slice("/dev/".length))
      if (sample.has(candidate)) hdd = candidate
      break
    }
  } catch {
    // Fall through — an unresolved HDD shows as "—" rather than as wrong numbers.
  }

  cachedDevices = { ssd, hdd }
  return cachedDevices
}

export async function diskIoRates(
  first: DiskSample,
  second: DiskSample,
  elapsedSeconds: number,
): Promise<DiskIoRates> {
  const devices = await resolveDevices(second)

  const rateFor = (device: string | null): DiskIo | null => {
    if (!device) return null
    const a = first.get(device)
    const b = second.get(device)
    if (!a || !b) {
      // The device disappeared between samples (USB unplug) — re-resolve next time.
      cachedDevices = null
      return null
    }
    return {
      readBytesPerSec: Math.max(0, (b.read - a.read) / elapsedSeconds),
      writeBytesPerSec: Math.max(0, (b.write - a.write) / elapsedSeconds),
    }
  }

  return { ssd: rateFor(devices.ssd), hdd: rateFor(devices.hdd) }
}
