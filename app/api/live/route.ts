import { NextResponse } from "next/server"
import { getDownloads } from "@/lib/downloads"
import { sampleLiveRates } from "@/lib/sampler"
import { getSensors } from "@/lib/sensors"
import { getSpeedtestState } from "@/lib/speedtest"
import { getDiskStats, getRamStats, getUptime } from "@/lib/system-stats"

// Same reason as app/api/stats/route.ts — this reads live host state on every
// request and must never be prerendered into a frozen snapshot.
export const dynamic = "force-dynamic"

async function getCapacity() {
  const [ssd, hdd, ram, uptime] = await Promise.all([
    getDiskStats("/host/root"),
    getDiskStats("/host/storage8tb"),
    getRamStats(),
    getUptime(),
  ])
  return { ssd, hdd, ram, uptime }
}

// One endpoint feeding every live card, so the browser polls once rather than
// six times. Each section settles independently: a dead download client leaves
// the temperatures alone, and an unreadable sensor leaves the disks alone.
export async function GET() {
  const [rates, capacity, sensors, downloads, speedtest] = await Promise.allSettled([
    sampleLiveRates(),
    getCapacity(),
    getSensors(),
    getDownloads(),
    getSpeedtestState(),
  ])

  return NextResponse.json({
    rates: rates.status === "fulfilled" ? rates.value : null,
    capacity: capacity.status === "fulfilled" ? capacity.value : null,
    sensors: sensors.status === "fulfilled" ? sensors.value : null,
    downloads: downloads.status === "fulfilled" ? downloads.value : null,
    speedtest: speedtest.status === "fulfilled" ? speedtest.value : null,
  })
}
