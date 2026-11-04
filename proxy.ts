import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE, cronTokenValid, sessionValid } from "@/lib/auth"

/**
 * The front door (added 2026-11-04). Every page and every API route goes through here first.
 * No valid login cookie: pages bounce to /login, API calls get a plain 401. Only the login page,
 * the login call and the logo on it are open. The matcher below already skips Next's own static
 * files and the tab icons.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (pathname === "/login" || pathname === "/api/auth/login" || pathname === "/logo.png") return NextResponse.next()

  // The server's own cron job, which has no browser to log in with. It shows a shared token instead.
  if (pathname === "/api/health/record" && request.method === "POST" && cronTokenValid(request.headers.get("x-cron-token"))) {
    return NextResponse.next()
  }

  if (sessionValid(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next()

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not logged in" }, { status: 401 })

  const login = new URL("/login", request.url)
  if (pathname !== "/") login.searchParams.set("next", pathname + search)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon-32x32.png|icon-64x64.png|apple-icon.png).*)"],
}
