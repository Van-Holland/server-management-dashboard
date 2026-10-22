import { HeaderBar } from "@/components/header-bar"
import { StatsCards } from "@/components/stats-cards"
import { StorageTile } from "@/components/live-cards"
import { DailyApps } from "@/components/apps-section"
import { ToolsSection } from "@/components/tools-section"
import { ServerPages } from "@/components/server-pages"
import { HealthBanner } from "@/components/health-banner"
import { getBackups } from "@/lib/backups"
import { getHardware } from "@/lib/hardware"
import { getHealthSnapshot } from "@/lib/health"
import { buildChecks, splitWarnings, summarize } from "@/lib/health-checks"
import { getMediaSummary } from "@/lib/media"
import { getSystemStats } from "@/lib/system-stats"

// Same reason as app/api/stats/route.ts — this page reads live host data on
// every request, so it can't be statically prerendered at build time.
export const dynamic = "force-dynamic"

export default async function HomePage() {
  // Backups read a handful of small log files, so they cost little and are
  // fetched alongside the system stats rather than serially after them.
  const [stats, backups, snapshot, hardware, media] = await Promise.all([
    getSystemStats(),
    getBackups(),
    getHealthSnapshot(),
    getHardware(),
    getMediaSummary(),
  ])

  // Two levels: red needs action today (the box below), maintenance needs action this week (the Health card and page, since 2026-10-20). A failed or overdue backup is a red one.
  const lists = splitWarnings(snapshot, backups)
  const { alerts } = lists

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col gap-8 sm:gap-10">
        <HeaderBar uptime={stats.uptime} />
        {/* Empty unless torrents or an indexer are silently broken. */}
        <HealthBanner warnings={alerts} />
        {/* Ordered by how often each part is used: the apps first, then how the
            server is doing, then the tools (the arr stack and the downloaders). */}
        <DailyApps />
        <StatsCards ssd={stats.ssd} hdd={stats.hdd} cpu={stats.cpu} ram={stats.ram} hardware={hardware} uptime={stats.uptime}>
          <ServerPages storage={<StorageTile />} media={media} backups={backups} health={summarize(buildChecks(snapshot, backups), lists)} />
        </StatsCards>
        <ToolsSection />
      </div>
    </main>
  )
}
