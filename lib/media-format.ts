export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(bytes >= 10_737_418_240 ? 0 : 1)} GB`
  return `${Math.round(bytes / 1_048_576)} MB`
}

export function formatMbps(bitrateBps: number | null): string {
  if (bitrateBps === null) return "—"
  return `${(bitrateBps / 1_000_000).toFixed(2)} Mbps`
}

export function formatRuntime(sec: number | null): string {
  if (sec === null) return "—"
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
