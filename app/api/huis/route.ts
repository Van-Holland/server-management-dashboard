import { NextResponse } from "next/server"
import { getHuisSnapshot } from "@/lib/huis"

// Live data from Home Assistant on every call (the page polls this every 10 seconds). Behind the dashboard login like everything else.
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(await getHuisSnapshot())
}
