/**
 * A small client for Home Assistant's REST API (added 2026-11-21), used only on the server.
 *
 * HA_URL and HA_TOKEN come from the server's .env (never from git). The token is a "long-lived access token" that Matthijs makes in his
 * Home Assistant profile. If either is missing, `haConfigured()` is false and the Heating and energy page says so instead of failing.
 */

export type HaState = {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed: string
  last_updated: string
}

const baseUrl = () => (process.env.HA_URL ?? "").replace(/\/+$/, "")
const token = () => process.env.HA_TOKEN ?? ""

export const haConfigured = () => baseUrl().length > 0 && token().length > 0

async function ha(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Home Assistant answered ${response.status} for ${path.split("?")[0]}`)
  return response
}

export async function getStates(): Promise<HaState[]> {
  return (await (await ha("/api/states")).json()) as HaState[]
}

// `last_changed` only moves when the state itself changes (for the thermostat: "auto" stays "auto"); `last_updated` also moves when an
// attribute changes, which is how the room temperature moves. Rows asked for with attributes carry both.
type HistoryRow = { entity_id?: string; state: string; attributes?: Record<string, unknown>; last_changed: string; last_updated?: string }

/**
 * The state history of some entities between two moments. The first row of each entity is its state at `start`
 * (Home Assistant includes it), which makes a tiny window a cheap way to ask "what was the total at midnight?".
 */
export async function getHistory(
  entityIds: string[],
  start: Date,
  end: Date,
  withAttributes = false,
): Promise<Record<string, HistoryRow[]>> {
  const params = new URLSearchParams({ filter_entity_id: entityIds.join(","), end_time: end.toISOString(), significant_changes_only: "0" })
  if (!withAttributes) {
    params.set("minimal_response", "")
    params.set("no_attributes", "")
  }
  const rows = (await (await ha(`/api/history/period/${encodeURIComponent(start.toISOString())}?${params}`)).json()) as HistoryRow[][]
  const byEntity: Record<string, HistoryRow[]> = {}
  for (const list of rows) {
    const id = list[0]?.entity_id
    if (id) byEntity[id] = list
  }
  return byEntity
}

/** The numeric value of an entity at a moment, or null when Home Assistant did not know it yet (or it is not a number). */
export async function totalAt(entityId: string, when: Date): Promise<number | null> {
  const rows = await getHistory([entityId], when, new Date(when.getTime() + 60_000))
  const first = rows[entityId]?.[0]
  const value = first ? Number(first.state) : NaN
  return Number.isFinite(value) ? value : null
}

export async function callService(domain: string, service: string, data: Record<string, unknown>): Promise<void> {
  await ha(`/api/services/${domain}/${service}`, { method: "POST", body: JSON.stringify(data) })
}
