import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { deleteMedia, type DeleteTarget } from "@/lib/media-delete"

// This route mutates real state, so it must never be prerendered or cached.
export const dynamic = "force-dynamic"

/**
 * The first write endpoint in this dashboard.
 *
 * There is no authentication here, and that is a deliberate inherited
 * decision rather than an oversight: the dashboard is published on port 3005
 * to the LAN and the tailnet only, with no router port forward anywhere, the
 * same posture already accepted for SABnzbd's unauthenticated web UI. Anyone
 * who can reach this page can already reach Sonarr and Radarr directly and
 * delete the same things there. What this route must not do is widen that —
 * hence no arbitrary path or command passthrough, only the four shapes below.
 *
 * The body is parsed defensively for the same reason. It arrives from a
 * browser, so "the UI would never send that" is not a guarantee about what
 * actually turns up.
 */
function parseTarget(raw: unknown): DeleteTarget | null {
  if (typeof raw !== "object" || raw === null) return null
  const body = raw as Record<string, unknown>

  const id = Number(body.id)
  if (!Number.isInteger(id) || id <= 0) return null

  switch (body.kind) {
    case "movie":
      return { kind: "movie", id }
    case "series":
      return { kind: "series", id }
    case "season": {
      const seasonNumber = Number(body.seasonNumber)
      // Season 0 is real — it is how Sonarr stores specials — so this checks
      // for a valid integer rather than for truthiness.
      if (!Number.isInteger(seasonNumber) || seasonNumber < 0) return null
      return { kind: "season", id, seasonNumber }
    }
    case "episode": {
      const episodeId = Number(body.episodeId)
      const episodeFileId = Number(body.episodeFileId)
      if (!Number.isInteger(episodeId) || episodeId <= 0) return null
      if (!Number.isInteger(episodeFileId) || episodeFileId <= 0) return null
      return { kind: "episode", id, episodeId, episodeFileId }
    }
    default:
      return null
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, summary: "Body was not valid JSON", steps: [] }, { status: 400 })
  }

  const target = parseTarget(body)
  if (!target) {
    return NextResponse.json(
      { ok: false, summary: "Not a valid delete target", steps: [] },
      { status: 400 },
    )
  }

  try {
    const result = await deleteMedia(target)
    // The media page reads Sonarr/Radarr on every request, but it is cached per
    // render — without this the page the user is looking at would keep showing
    // the item it just deleted until something else forced a refresh.
    revalidatePath("/media")
    return NextResponse.json(result, { status: result.ok ? 200 : 500 })
  } catch (error) {
    console.error("Media delete failed:", error)
    return NextResponse.json(
      {
        ok: false,
        summary: error instanceof Error ? error.message : "Delete failed",
        steps: [],
      },
      { status: 500 },
    )
  }
}
