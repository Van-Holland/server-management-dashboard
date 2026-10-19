import { TriangleAlert } from "lucide-react"
import type { HealthWarning } from "@/lib/health"

/**
 * Renders nothing when everything it can see is fine, so a healthy dashboard
 * looks exactly as it did before. Only appears when something needs a person.
 */
export function HealthBanner({ warnings }: { warnings: HealthWarning[] }) {
  if (warnings.length === 0) return null

  return (
    <div role="alert" className="rounded-xl border border-usage-high/40 bg-card p-5">
      <div className="flex items-center gap-2">
        <TriangleAlert className="size-4 text-usage-high" aria-hidden="true" />
        <p className="text-sm font-medium text-usage-high">Needs attention</p>
      </div>
      <ul className="mt-3 space-y-3">
        {warnings.map((w) => (
          <li key={w.id}>
            <p className="text-sm font-medium text-foreground">{w.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{w.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
