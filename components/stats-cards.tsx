import { LiveCards, type InitialStats } from "@/components/live-cards"

export function StatsCards(initial: InitialStats) {
  return (
    // Six columns so six cards divide cleanly into two rows of three at desktop
    // width. At tablet width the grid drops to two columns, with the two widest
    // cards going full-bleed, so no card is ever left stranded beside a gap.
    //
    // Every card lives in LiveCards and updates on the shared 2s poll; the values
    // passed in here are the server-rendered ones, used only for first paint.
    <section
      aria-label="System stats"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6"
    >
      <LiveCards initial={initial} />
    </section>
  )
}
