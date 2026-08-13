import { HeaderBar } from "@/components/header-bar"
import { StatsCards } from "@/components/stats-cards"
import { AppsSection } from "@/components/apps-section"
import { BackupCard } from "@/components/backup-status"
import { getBackups } from "@/lib/backups"
import { getSystemStats } from "@/lib/system-stats"

// Same reason as app/api/stats/route.ts — this page reads live host data on
// every request, so it can't be statically prerendered at build time.
export const dynamic = "force-dynamic"

export default async function HomePage() {
  // Backups read a handful of small log files, so they cost little and are
  // fetched alongside the system stats rather than serially after them.
  const [stats, backups] = await Promise.all([getSystemStats(), getBackups()])

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col gap-10">
        <HeaderBar uptime={stats.uptime} />
        <StatsCards ssd={stats.ssd} hdd={stats.hdd} cpu={stats.cpu} ram={stats.ram} />
        {/* Full-width strip rather than a 7th card: the stats grid is 6 columns
            precisely so its six cards land as two clean rows of three. */}
        <BackupCard snapshot={backups} />
        <AppsSection />
      </div>
    </main>
  )
}
