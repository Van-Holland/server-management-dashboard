import { NextResponse } from "next/server"
import { getSpeedtestState, triggerSpeedtest } from "@/lib/speedtest"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(await getSpeedtestState())
}

// Starting a test is a side effect on the whole household's internet, so it's a
// POST rather than something a link prefetch or a refresh could set off.
export async function POST() {
  const outcome = await triggerSpeedtest()
  // 429 on "too-soon" so the rate limit is visible to anything scripting this,
  // not just to the card's own UI.
  const status = outcome.status === "too-soon" ? 429 : 202
  return NextResponse.json(outcome, { status })
}
