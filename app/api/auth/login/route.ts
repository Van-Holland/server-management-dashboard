import { NextResponse } from "next/server"
import { SESSION_COOKIE, SESSION_DAYS, authConfigured, lockedFor, makeSession, passwordMatches, recordFail, recordSuccess, safeNext } from "@/lib/auth"

export const dynamic = "force-dynamic"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function POST(request: Request) {
  if (!authConfigured()) return NextResponse.json({ error: "Login is not set up on this server." }, { status: 503 })

  const locked = lockedFor()
  if (locked > 0) return NextResponse.json({ error: `Too many tries. Wait ${locked} seconds.` }, { status: 429 })

  const body = await request.json().catch(() => ({}))
  const password = typeof body?.password === "string" ? body.password : ""

  if (!password || !passwordMatches(password)) {
    recordFail()
    await wait(600) // a wrong guess is slow on purpose
    return NextResponse.json({ error: "Wrong password." }, { status: 401 })
  }

  recordSuccess()
  const response = NextResponse.json({ ok: true, next: safeNext(body?.next) })
  response.cookies.set(SESSION_COOKIE, makeSession(), {
    httpOnly: true, // page scripts cannot read it
    sameSite: "lax", // other websites cannot make your browser send it on a POST
    secure: false, // the dashboard is served over plain http on the home network
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
  return response
}
