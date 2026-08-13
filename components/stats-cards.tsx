import { HardDrive, Database, Cpu } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { LiveCards } from "@/components/live-cards"
import { ProgressBar, usageColor } from "@/components/progress-bar"

function formatSize(gb: number) {
  if (gb >= 1000) return `${(gb / 1000).toFixed(2)} TB`
  return `${gb} GB`
}

function DiskCard({
  label,
  usedGb,
  totalGb,
  icon: Icon,
}: {
  label: string
  usedGb: number
  totalGb: number
  icon: LucideIcon
}) {
  const pct = Math.min(100, Math.round((usedGb / totalGb) * 100))
  return (
    <div className="h-full rounded-xl border border-border bg-card p-5 sm:p-6 lg:col-span-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground">
              {formatSize(usedGb)} <span className="opacity-60">/</span> {formatSize(totalGb)}
            </p>
          </div>
        </div>
        <p className="font-mono text-2xl font-semibold tabular-nums text-foreground">
          {pct}
          <span className="text-base text-muted-foreground">%</span>
        </p>
      </div>
      <div className="mt-5">
        <ProgressBar pct={pct} label={`${label} usage`} color={usageColor(pct)} />
      </div>
    </div>
  )
}

function MetricRow({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">{pct}%</span>
      </div>
      <ProgressBar pct={pct} label={`${label} usage`} color={usageColor(pct)} />
    </div>
  )
}

function SystemCard({ cpu, ram }: { cpu: number; ram: number }) {
  return (
    <div className="h-full rounded-xl border border-border bg-card p-5 sm:col-span-2 sm:p-6 lg:col-span-2">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Cpu className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">System</p>
          <p className="text-xs text-muted-foreground">Load</p>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-3">
        <MetricRow label="CPU" pct={cpu} />
        <MetricRow label="RAM" pct={ram} />
      </div>
    </div>
  )
}

export function StatsCards({
  ssd,
  hdd,
  cpu,
  ram,
}: {
  ssd: { usedGb: number; totalGb: number }
  hdd: { usedGb: number; totalGb: number }
  cpu: number
  ram: number
}) {
  return (
    // Six columns so five cards divide cleanly at desktop width: the three
    // fixed-size stat cards take two columns each (a row of three), and the two
    // wider live cards take three each (a row of two). At tablet width the
    // grid drops to two columns and the wide cards go full-bleed, so no card is
    // ever left stranded beside a gap.
    <section
      aria-label="System stats"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6"
    >
      <DiskCard label="SSD" usedGb={ssd.usedGb} totalGb={ssd.totalGb} icon={HardDrive} />
      <DiskCard label="HDD" usedGb={hdd.usedGb} totalGb={hdd.totalGb} icon={Database} />
      <SystemCard cpu={cpu} ram={ram} />
      <LiveCards />
    </section>
  )
}
