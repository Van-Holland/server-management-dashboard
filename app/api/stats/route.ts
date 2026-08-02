import { NextResponse } from "next/server"
import { getSystemStats } from "@/lib/system-stats"

// Without this, Next would statically prerender the response once at build time
// and serve that same frozen snapshot forever.
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const stats = await getSystemStats()
    return NextResponse.json(stats)
  } catch (error) {
    console.error("Failed to read system stats:", error)
    return NextResponse.json({ error: "Failed to read system stats" }, { status: 500 })
  }
}
