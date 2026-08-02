import { HardDrive, Database, Cpu } from "lucide-react"
import type { LucideIcon } from "lucide-react"

function usageColor(pct: number) {
  if (pct < 60) return "bg-usage-low"
  if (pct <= 85) return "bg-usage-mid"
  return "bg-usage-high"
}

function UsageBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-secondary"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={`h-full rounded-full transition-all ${usageColor(pct)}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

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
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
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
        <UsageBar pct={pct} label={`${label} usage`} />
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
      <UsageBar pct={pct} label={`${label} usage`} />
    </div>
  )
}

function SystemCard({ cpu, ram }: { cpu: number; ram: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
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
    <section aria-label="System stats" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <DiskCard label="SSD" usedGb={ssd.usedGb} totalGb={ssd.totalGb} icon={HardDrive} />
      <DiskCard label="HDD" usedGb={hdd.usedGb} totalGb={hdd.totalGb} icon={Database} />
      <SystemCard cpu={cpu} ram={ram} />
    </section>
  )
}
