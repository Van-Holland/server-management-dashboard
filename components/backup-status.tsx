import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { BackupVerdict } from "@/lib/backups"

/**
 * Presentation for backup verdicts. Reuses the same usage-low/mid/high tokens
 * as the disk and CPU bars so "green means fine" carries the same meaning
 * everywhere on the dashboard rather than being re-invented per card.
 */
const PRESENTATION: Record<BackupVerdict, { label: string; text: string; dot: string }> = {
  ok: { label: "OK", text: "text-usage-low", dot: "bg-usage-low" },
  late: { label: "Late", text: "text-usage-mid", dot: "bg-usage-mid" },
  overdue: { label: "Overdue", text: "text-usage-high", dot: "bg-usage-high" },
  failed: { label: "Failed", text: "text-usage-high", dot: "bg-usage-high" },
  // Grey, not green. An unreadable log is not a passing backup, and colouring
  // it green would recreate the exact failure this page exists to catch.
  unknown: { label: "Unknown", text: "text-muted-foreground", dot: "bg-muted-foreground" },
}

const ICONS: Record<BackupVerdict, LucideIcon> = {
  ok: ShieldCheck,
  late: ShieldAlert,
  overdue: ShieldAlert,
  failed: ShieldAlert,
  unknown: ShieldQuestion,
}

export function verdictStyle(verdict: BackupVerdict) {
  return PRESENTATION[verdict]
}

export function verdictIcon(verdict: BackupVerdict): LucideIcon {
  return ICONS[verdict]
}

export function formatAge(hours: number | null): string {
  if (hours === null) return "never"
  if (hours < 1) return "just now"
  if (hours < 24) return `${Math.floor(hours)}h ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}
