import { NextResponse } from "next/server"
import { parseTariffs, readTariffs, writeTariffs } from "@/lib/tariffs"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ periods: await readTariffs() })
}

// Replaces the whole list of price periods: { periods: [{ from, electricityPerKwh, gasPerM3, fixedPerMonth, note? }] }.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}))
  const parsed = parseTariffs(body?.periods)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    await writeTariffs(parsed.periods)
    return NextResponse.json({ ok: true, periods: parsed.periods })
  } catch {
    return NextResponse.json({ error: "The prices could not be saved on the server." }, { status: 500 })
  }
}
