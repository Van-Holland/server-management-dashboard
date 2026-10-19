import { LiveCards, type InitialStats } from "@/components/live-cards"

// Every card lives in LiveCards and updates on the shared 2s poll; the values
// passed in here are the server-rendered ones, used only for first paint.
export function StatsCards(initial: InitialStats) {
  return <LiveCards initial={initial} />
}
