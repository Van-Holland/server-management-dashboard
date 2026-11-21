import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { HuisTariffs } from "@/components/huis-tariffs"
import { readTariffs } from "@/lib/tariffs"

// Reads the saved prices from disk on every request.
export const dynamic = "force-dynamic"

export default async function TariffsPage() {
  const periods = await readTariffs()
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col gap-8">
        <div>
          <Link href="/huis" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to heating and energy
          </Link>
          <h1 className="mt-4 text-2xl font-semibold text-foreground">Tariffs</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your energy prices. The cost on the page is use times these prices, plus the fixed monthly amount.</p>
        </div>
        <HuisTariffs initial={periods} />
      </div>
    </main>
  )
}
