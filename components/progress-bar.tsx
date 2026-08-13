// Shared progress bar for every card that shows a percentage — the disk cards,
// the CPU/RAM rows, and the download queue. Kept in one place so the download
// bar matches the SSD/HDD bars by construction rather than by copied classnames.

export function usageColor(pct: number) {
  if (pct < 60) return "bg-usage-low"
  if (pct <= 85) return "bg-usage-mid"
  return "bg-usage-high"
}

export function ProgressBar({
  pct,
  label,
  color = "bg-usage-low",
}: {
  pct: number
  label: string
  // Disk/CPU/RAM pass usageColor(pct) — green turning orange then red as the
  // thing fills up. Downloads pass nothing and stay green, because a download
  // being 90% finished is good news, not a warning.
  color?: string
}) {
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-secondary"
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
