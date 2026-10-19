import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const TIMEOUT_MS = 6000

/**
 * Cover art for the Media page, fetched server-side.
 *
 * The browser cannot ask Sonarr or Radarr directly: their API key must not
 * reach the page, and the LAN address does not work from the tailnet. So the
 * dashboard fetches the poster and hands the bytes on. Only two shapes are
 * accepted (series or movie plus a numeric id) so this cannot be used to reach
 * any other path on either app.
 *
 * `poster-250.jpg` is the small size the apps keep on disk: 12-22 KB each, which
 * is why a grid of 35 posters costs well under 1 MB.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await ctx.params
  const arrId = Number(id)
  if ((kind !== "series" && kind !== "movie") || !Number.isInteger(arrId) || arrId <= 0) {
    return new NextResponse(null, { status: 404 })
  }

  const base =
    kind === "series"
      ? (process.env.SONARR_URL ?? "http://192.168.178.241:8989")
      : (process.env.RADARR_URL ?? "http://192.168.178.241:7878")
  const key = kind === "series" ? process.env.SONARR_API_KEY : process.env.RADARR_API_KEY
  if (!key) return new NextResponse(null, { status: 404 })

  try {
    // The key goes in the query string here on purpose: the /MediaCover/ path
    // that honours the X-Api-Key header answers 302 (a login redirect), while
    // this API path answers 200 with the image. It only ever travels
    // server-to-server.
    const res = await fetch(`${base}/api/v3/mediacover/${arrId}/poster-250.jpg?apikey=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    })
    if (!res.ok) return new NextResponse(null, { status: 404 })
    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        // A poster changes about never; a day in the browser cache is plenty.
        "Cache-Control": "public, max-age=86400",
      },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
