import { ChevronDown, ChevronRight, EyeOff } from "lucide-react"
import { GROUPS, type CheckStatus, type HealthCheck } from "@/lib/health-checks"

/**
 * The body of the Health page (added 2026-10-20): every check the dashboard makes, grouped, one line each. A tap opens a
 * row to say what it looks at, when it turns yellow or red, and what to do. Native <details>, no client JavaScript.
 * The apps and websites are small chips, because nineteen full rows would bury the rest.
 */

const DOT: Record<CheckStatus, string> = {
  ok: "bg-usage-low",
  maintenance: "bg-usage-mid",
  alert: "bg-usage-high",
  unknown: "bg-muted-foreground",
}
const TEXT: Record<CheckStatus, string> = {
  ok: "text-usage-low",
  maintenance: "text-usage-mid",
  alert: "text-usage-high",
  unknown: "text-muted-foreground",
}
const RANK: Record<CheckStatus, number> = { alert: 0, maintenance: 1, unknown: 2, ok: 3 }

function worstOf(checks: HealthCheck[]): CheckStatus {
  return checks.reduce<CheckStatus>((acc, c) => (RANK[c.status] < RANK[acc] ? c.status : acc), "ok")
}

function groupLine(checks: HealthCheck[]): string {
  const bad = checks.filter((c) => c.status === "alert").length
  const warn = checks.filter((c) => c.status === "maintenance").length
  if (bad > 0) return `${bad} need${bad === 1 ? "s" : ""} attention`
  if (warn > 0) return `${warn} for this week`
  const unknown = checks.filter((c) => c.status === "unknown").length
  if (unknown > 0) return `${unknown} without data`
  return checks.length === 1 ? "fine" : `all ${checks.length} fine`
}

function Row({ check }: { check: HealthCheck }) {
  return (
    <details className="group border-t border-border first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground group-open:hidden" aria-hidden="true" />
        <ChevronDown className="hidden size-4 shrink-0 text-muted-foreground group-open:block" aria-hidden="true" />
        <span className={`size-2 shrink-0 rounded-full ${DOT[check.status]}`} aria-hidden="true" />
        {/* Phone: the name with its sentence underneath. Wider screens: one line, name then sentence. */}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="shrink-0 text-foreground sm:w-52 sm:truncate">{check.name}</span>
          <span className={`min-w-0 text-xs sm:flex-1 sm:truncate ${check.status === "ok" ? "text-muted-foreground" : TEXT[check.status]}`}>{check.summary}</span>
        </span>
        <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">{check.every}</span>
      </summary>
      <div className="space-y-2 px-4 pb-4 pl-11 text-xs text-muted-foreground">
        {check.warnings.map((w) => (
          <p key={w.id} className={TEXT[check.status]}>
            {w.title}. {w.detail}
          </p>
        ))}
        <p>
          <span className="font-medium text-foreground">What it looks at.</span> {check.looksAt}
        </p>
        <p>
          <span className="font-medium text-foreground">When it turns yellow or red.</span> {check.rule}
        </p>
        {check.fix && (
          <p>
            <span className="font-medium text-foreground">What to do.</span> {check.fix}
          </p>
        )}
        <p className="md:hidden">Checked {check.every}.</p>
      </div>
    </details>
  )
}

function Chips({ checks }: { checks: HealthCheck[] }) {
  const sorted = [...checks].sort((a, b) => RANK[a.status] - RANK[b.status])
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="flex flex-wrap gap-2">
        {sorted.map((c) => (
          <span
            key={c.id}
            title={c.summary}
            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${
              c.status === "ok" ? "border-border text-muted-foreground" : `border-usage-high/50 ${TEXT[c.status]}`
            }`}
          >
            <span className={`size-1.5 rounded-full ${DOT[c.status]}`} aria-hidden="true" />
            {c.name}
          </span>
        ))}
      </div>
      {sorted.filter((c) => c.status !== "ok").map((c) => (
        <p key={c.id} className={`mt-2 text-xs ${TEXT[c.status]}`}>
          {c.name}: {c.summary}
        </p>
      ))}
    </div>
  )
}

const NOT_WATCHED = [
  ["Domain renewal", "vanhollandit.com and vanhollandpm.co.uk: a forgotten renewal would take the websites down."],
  ["Proton Drive login", "The nightly Proton jobs stop quietly when the login dies. Today you would only see it on the Backups page."],
  ["Requested but never arriving", "A film or show you asked for that never shows up, even though every part above is fine."],
]

export function HealthOverview({ checks }: { checks: HealthCheck[] }) {
  return (
    <div className="flex flex-col gap-6">
      {GROUPS.map((g) => {
        const inGroup = checks.filter((c) => c.group === g.id)
        if (inGroup.length === 0) return null
        const status = worstOf(inGroup)
        return (
          <section key={g.id} aria-labelledby={`h-${g.id}`}>
            <div className="mb-2 flex items-center gap-2">
              <span className={`size-2 rounded-full ${DOT[status]}`} aria-hidden="true" />
              <h2 id={`h-${g.id}`} className="text-sm font-medium text-foreground">
                {g.title}
              </h2>
              <span className={`text-xs ${status === "ok" ? "text-muted-foreground" : TEXT[status]}`}>{groupLine(inGroup)}</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {g.id === "apps" || g.id === "containers" ? <Chips checks={inGroup} /> : [...inGroup].sort((a, b) => RANK[a.status] - RANK[b.status]).map((c) => <Row key={c.id} check={c} />)}
            </div>
          </section>
        )
      })}

      <section aria-labelledby="h-not-watched">
        <div className="mb-2 flex items-center gap-2">
          <EyeOff className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 id="h-not-watched" className="text-sm font-medium text-muted-foreground">
            Not watched yet
          </h2>
        </div>
        <ul className="space-y-2 rounded-xl border border-dashed border-border p-4">
          {NOT_WATCHED.map(([name, why]) => (
            <li key={name} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{name}.</span> {why}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
