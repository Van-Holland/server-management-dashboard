import { HeaderBar } from "@/components/header-bar"
import { StatsCards } from "@/components/stats-cards"
import { AppsSection } from "@/components/apps-section"

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col gap-10">
        <HeaderBar />
        <StatsCards />
        <AppsSection />
      </div>
    </main>
  )
}
