import { NextResponse } from "next/server"
import { getBackups } from "@/lib/backups"
import { getHealthSnapshot } from "@/lib/health"
import { splitWarnings } from "@/lib/health-checks"
import { recordHealth } from "@/lib/health-history"

// Called every 5 minutes by a cron job on the server. It only writes down what is wrong at this moment (see lib/health-history.ts),
// so calling it more often, or by hand, does no harm.
export const dynamic = "force-dynamic"

export async function POST() {
  const [snapshot, backups] = await Promise.all([getHealthSnapshot(), getBackups()])
  const { alerts, maintenance } = splitWarnings(snapshot, backups)
  const result = await recordHealth([...alerts, ...maintenance.map((w) => ({ ...w, level: "maintenance" as const }))], Date.now())
  return NextResponse.json(result)
}
