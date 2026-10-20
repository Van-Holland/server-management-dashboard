import { Wrench } from "lucide-react"
import type { HealthWarning } from "@/lib/health"

/**
 * The calm half of "Needs attention" (added 2026-10-20): things that want doing this week, not today, so they must not
 * shout. A closed one-line summary; the details open on a tap. Renders nothing when there is nothing to do.
 */
export function MaintenanceNote({ items }: { items: HealthWarning[] }) {
  if (items.length === 0) return null

  return (
    <details className="group rounded-[14px] border border-border px-5 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Wrench className="size-4" aria-hidden="true" />
        <span>
          Maintenance · {items.length} {items.length === 1 ? "thing" : "things"} for this week
        </span>
        <span className="ml-auto text-xs group-open:hidden">Show</span>
        <span className="ml-auto hidden text-xs group-open:inline">Hide</span>
      </summary>
      <ul className="mt-3 space-y-3 border-t border-border pt-3">
        {items.map((w) => (
          <li key={w.id}>
            <p className="text-sm text-foreground">{w.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{w.detail}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}
