import { NextResponse } from "next/server"
import { currentPlan, setPlan } from "@/lib/huis"
import { validatePlan } from "@/lib/huis-plan"

export const dynamic = "force-dynamic"

// Changes the heating plan: { dayTemp, nightTemp, dayStart, eveningStart, nightStart, testOn, testSeries }. Send only what changes.
export async function POST(request: Request) {
  try {
    const current = await currentPlan()
    if (!current.available) return NextResponse.json({ error: "The plan helpers are not installed in Home Assistant yet." }, { status: 409 })
    const checked = validatePlan(await request.json().catch(() => ({})), current)
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
    await setPlan(checked.change)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Home Assistant could not be reached." }, { status: 502 })
  }
}
