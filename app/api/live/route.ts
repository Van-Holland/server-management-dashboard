import { NextResponse } from "next/server"
import { getDownloads } from "@/lib/downloads"
import { getNetworkRates } from "@/lib/network-stats"
import { getSpeedtestState } from "@/lib/speedtest"

// Same reason as app/api/stats/route.ts — this reads live host state on every
// request and must never be prerendered into a frozen snapshot.
export const dynamic = "force-dynamic"

// One endpoint feeding both live cards, so the browser polls once rather than
// twice. Each section settles independently: a dead download client leaves the
// network readout alone, and vice versa.
export async function GET() {
  const [network, downloads, speedtest] = await Promise.allSettled([
    getNetworkRates(),
    getDownloads(),
    getSpeedtestState(),
  ])

  return NextResponse.json({
    network: network.status === "fulfilled" ? network.value : null,
    downloads: downloads.status === "fulfilled" ? downloads.value : null,
    speedtest: speedtest.status === "fulfilled" ? speedtest.value : null,
  })
}
