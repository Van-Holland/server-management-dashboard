import { NextResponse } from "next/server"
import { setAway, validateAway } from "@/lib/huis"

export const dynamic = "force-dynamic"

// Sets the away mode of the heating: { mode: "Thuis" | "Kort weg" | "Lang weg", until: "YYYY-MM-DDTHH:mm" } (until only for the two away modes).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const checked = validateAway(body?.mode, body?.until)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  try {
    await setAway(checked.mode, checked.until)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Home Assistant could not be reached." }, { status: 502 })
  }
}
