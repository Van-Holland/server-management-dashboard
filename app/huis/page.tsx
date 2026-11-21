import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { HuisView } from "@/components/huis-view"
import { getHuisSnapshot } from "@/lib/huis"

// Live data from Home Assistant on every request.
export const dynamic = "force-dynamic"

export default async function HuisPage() {
  const snapshot = await getHuisSnapshot()
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col gap-8">
        <div>
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to dashboard
          </Link>
          <h1 className="mt-4 text-2xl font-semibold text-foreground">Heating and energy</h1>
          <p className="mt-1 text-sm text-muted-foreground">The thermostat, the gas and the electricity, from Home Assistant.</p>
        </div>
        <HuisView initial={snapshot} />
      </div>
    </main>
  )
}
