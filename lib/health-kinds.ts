/**
 * Which warnings are CHORES and which are FAULTS (added 2026-10-22), for the Health history.
 *
 * Colour says how urgent a warning is (red: today, yellow: this week). It does not say what kind it is. A fault is something that
 * broke, and one that clears by itself is worth knowing about (the VPN restarted, the internet dropped). A chore is something waiting
 * for you (an update, a key about to expire, leftover downloads): when it disappears, you did it, so it is not interesting history.
 *
 * Everything is recorded; this list only decides what the history shows by default. A warning that is not listed here counts as a
 * fault, so a new kind of warning is never hidden by accident. Pure functions, no server imports: the Health page's client part uses them too.
 */

const CHORE_PREFIXES = [
  "arr-update-",
  "image-update", // image-update-immich, image-updates
  "updates",
  "tailscale-key",
  "leftover-downloads",
  "disk-",
  "proton-full",
  "smart-nvme-worn",
  "smart-not-set-up",
  "internet-outages-often", // a summary of outages that are already listed one by one
]

/** Warnings that stay up for a while AFTER the event ("The internet was down for 1 h 42 min" shows for 24 hours). Their start to end is
 *  how long the notice was shown, not how long the fault lasted, so the history shows only when they were reported. */
const ECHO_IDS = ["internet-outage-recent", "vpn-restarted"]

export type WarningKind = "fault" | "chore"

export function kindOf(id: string): WarningKind {
  return CHORE_PREFIXES.some((p) => id.startsWith(p)) ? "chore" : "fault"
}

export function isEcho(id: string): boolean {
  return ECHO_IDS.includes(id)
}
