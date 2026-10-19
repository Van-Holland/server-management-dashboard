import { HeaderBar } from "@/components/header-bar"
import { StatsCards } from "@/components/stats-cards"
import { DailyApps, ToolsSection } from "@/components/apps-section"
import { BackupCard } from "@/components/backup-status"
import { HealthBanner } from "@/components/health-banner"
import { getBackups } from "@/lib/backups"
import { getHardware } from "@/lib/hardware"
import { getHealthWarnings } from "@/lib/health"
import { getSystemStats } from "@/lib/system-stats"

// Same reason as app/api/stats/route.ts — this page reads live host data on
// every request, so it can't be statically prerendered at build time.
export const dynamic = "force-dynamic"

export default async function HomePage() {
  // Backups read a handful of small log files, so they cost little and are
  // fetched alongside the system stats rather than serially after them.
  const [stats, backups, warnings, hardware] = await Promise.all([
    getSystemStats(),
    getBackups(),
    getHealthWarnings(),
    getHardware(),
  ])

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col gap-10">
        <HeaderBar uptime={stats.uptime} />
        {/* Empty unless torrents or an indexer are silently broken. */}
        <HealthBanner warnings={warnings} />
        {/* Ordered by how often each part is used: the apps first, then how the
            server is doing, then the tools that are rarely opened. */}
        <DailyApps />
        <div className="flex flex-col gap-4">
          <StatsCards ssd={stats.ssd} hdd={stats.hdd} cpu={stats.cpu} ram={stats.ram} hardware={hardware} />
          <BackupCard snapshot={backups} />
        </div>
        <ToolsSection />
      </div>
    </main>
  )
}
