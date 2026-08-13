import { readFile, readdir } from "node:fs/promises"

export type Battery = { name: string; percent: number; status: string }

export type Sensors = {
  /** CPU package temperature, °C. */
  cpuTempC: number | null
  /** NVMe SSD composite temperature, °C. The 8TB HDD is a USB enclosure with no
   *  hwmon node — reading it would need smartctl and device access, so it has no
   *  temperature here by design, not by omission. */
  ssdTempC: number | null
  fanRpm: number | null
  power: {
    /** true = mains, false = running on battery, null = no AC node found. */
    onAc: boolean | null
    batteries: Battery[]
  }
}

// The /:/host/root:ro bind mount is recursive, so sysfs came along with it.
// No extra mounts or capabilities are needed for any of this.
const HWMON_ROOT = "/host/root/sys/class/hwmon"
const POWER_SUPPLY_ROOT = "/host/root/sys/class/power_supply"

async function readNumber(path: string): Promise<number | null> {
  try {
    const value = Number.parseInt((await readFile(path, "utf-8")).trim(), 10)
    return Number.isNaN(value) ? null : value
  } catch {
    return null
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf-8")).trim()
  } catch {
    return null
  }
}

// hwmon indices are NOT stable: hwmon4 is the NVMe drive today and could be the
// WiFi card after a reboot. Always resolve by the driver name in hwmonN/name.
// Cached because that's ~11 small reads, and invalidated whenever an expected
// sensor stops responding.
let hwmonCache: Map<string, string> | null = null

async function resolveHwmon(): Promise<Map<string, string>> {
  if (hwmonCache) return hwmonCache

  const resolved = new Map<string, string>()
  try {
    for (const entry of await readdir(HWMON_ROOT)) {
      const name = await readText(`${HWMON_ROOT}/${entry}/name`)
      // First match wins; the kernel can expose more than one node per driver.
      if (name && !resolved.has(name)) resolved.set(name, `${HWMON_ROOT}/${entry}`)
    }
  } catch {
    // sysfs unreadable — every sensor below degrades to null.
  }

  hwmonCache = resolved
  return resolved
}

// hwmon temperatures are in millidegrees Celsius.
function toCelsius(milli: number | null): number | null {
  return milli === null ? null : Math.round(milli / 100) / 10
}

async function getBatteries(): Promise<Battery[]> {
  const batteries: Battery[] = []
  try {
    for (const entry of (await readdir(POWER_SUPPLY_ROOT)).sort()) {
      if (!entry.startsWith("BAT")) continue
      const percent = await readNumber(`${POWER_SUPPLY_ROOT}/${entry}/capacity`)
      if (percent === null) continue
      batteries.push({
        name: entry,
        percent,
        status: (await readText(`${POWER_SUPPLY_ROOT}/${entry}/status`)) ?? "Unknown",
      })
    }
  } catch {
    // No power supply class — desktop hardware, or sysfs unreadable.
  }
  return batteries
}

export async function getSensors(): Promise<Sensors> {
  const hwmon = await resolveHwmon()
  const coretemp = hwmon.get("coretemp")
  const nvme = hwmon.get("nvme")
  const thinkpad = hwmon.get("thinkpad")

  const [cpuMilli, ssdMilli, fanRpm, acOnline, batteries] = await Promise.all([
    coretemp ? readNumber(`${coretemp}/temp1_input`) : null,
    nvme ? readNumber(`${nvme}/temp1_input`) : null,
    thinkpad ? readNumber(`${thinkpad}/fan1_input`) : null,
    readNumber(`${POWER_SUPPLY_ROOT}/AC/online`),
    getBatteries(),
  ])

  // A sensor that resolved but then stopped reading means the hwmon numbering
  // moved under us — drop the cache so the next poll re-resolves by name.
  if ((coretemp && cpuMilli === null) || (nvme && ssdMilli === null)) {
    hwmonCache = null
  }

  return {
    cpuTempC: toCelsius(cpuMilli),
    ssdTempC: toCelsius(ssdMilli),
    fanRpm,
    power: {
      onAc: acOnline === null ? null : acOnline === 1,
      batteries,
    },
  }
}
