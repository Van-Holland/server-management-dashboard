import { NextResponse } from "next/server"
import { setTemperature, validateTemperature } from "@/lib/huis"

export const dynamic = "force-dynamic"

// Sets the target temperature: { temperature: 21 }. Only 10 to 25 degrees, in steps of 0.5.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const checked = validateTemperature(body?.temperature)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  try {
    await setTemperature(checked.temperature)
    return NextResponse.json({ ok: true, temperature: checked.temperature })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Home Assistant could not be reached." }, { status: 502 })
  }
}
