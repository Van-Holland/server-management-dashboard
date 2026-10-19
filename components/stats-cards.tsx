import type { ReactNode } from "react"
import { LiveCards, type InitialStats } from "@/components/live-cards"

// Every card lives in LiveCards and updates on the shared 2s poll; the values
// passed in here are the server-rendered ones, used only for first paint.
// `children` is server-rendered content shown at the bottom of the Server section.
export function StatsCards({ children, ...initial }: InitialStats & { children?: ReactNode }) {
  return <LiveCards initial={initial}>{children}</LiveCards>
}
