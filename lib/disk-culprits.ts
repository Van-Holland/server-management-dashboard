import { readdir, readFile } from "node:fs/promises"

/**
 * WHO is using the 8TB drive right now (added 2026-10-20), for the line under the HDD tile.
 *
 * The kernel keeps a counter per container and per service of the bytes and operations on each drive (cgroup v2 `io.stat`, one
 * line per device, "8:0 rbytes=... wbytes=... rios=... wios=..."). The dashboard sees the host's files through its existing
 * /host/root mount, so no extra access is needed. Each call stores a reading; the rates come from the readings of the last ~10 seconds,
 * so a name does not flicker with every poll. It can say WHO (sonarr, Samba, the cron jobs) but not WHAT they are doing.
 */

const CGROUP = "/host/root/sys/fs/cgroup"
const PROBE_FILE = "/host/root/home/matt/health-probe-status.json"
const WINDOW_MS = 10_000

type Totals = Map<string, { bytes: number; ops: number }>
type Snap = { t: number; totals: Totals }
export type Culprit = { name: string; opsPerSec: number; kbPerSec: number }
export type DiskCulprits = { warming: boolean; quiet: boolean; items: Culprit[] }

const g = globalThis as typeof globalThis & { __culpritSnaps?: Snap[]; __idMap?: { at: number; map: Map<string, string> } }
const snaps: Snap[] = (g.__culpritSnaps ??= [])

const SERVICE_LABELS: Record<string, string> = {
  "smbd.service": "Samba (file sharing, Time Machine)",
  "cron.service": "scheduled jobs (cron)",
  "docker.service": "Docker itself",
  "containerd.service": "Docker itself",
  "tailscaled.service": "Tailscale",
  "cloudflared.service": "Cloudflare tunnel",
  "user.slice": "a login session (SSH)",
}

/** Container ids to names, from the file the server's health job writes. Re-read every minute. */
async function idMap(): Promise<Map<string, string>> {
  const cached = g.__idMap
  if (cached && Date.now() - cached.at < 60_000) return cached.map
  const map = new Map<string, string>()
  try {
    const probe = JSON.parse(await readFile(PROBE_FILE, "utf-8")) as { containers?: { idMap?: { id: string; name: string }[] } }
    for (const c of probe.containers?.idMap ?? []) map.set(c.id, c.name)
  } catch {
    // Without the file a container shows as its short id: ugly but not wrong.
  }
  g.__idMap = { at: Date.now(), map }
  return map
}

async function readTotals(majMin: string): Promise<Totals> {
  const totals: Totals = new Map()
  const entries = await readdir(`${CGROUP}/system.slice`)
  await Promise.all(
    entries
      .filter((e) => e.endsWith(".scope") || e.endsWith(".service"))
      .map(async (entry) => {
        try {
          const text = await readFile(`${CGROUP}/system.slice/${entry}/io.stat`, "utf-8")
          for (const line of text.split("\n")) {
            if (!line.startsWith(`${majMin} `)) continue
            const kv = Object.fromEntries(line.split(" ").slice(1).map((x) => x.split("=")))
            totals.set(entry, { bytes: Number(kv.rbytes) + Number(kv.wbytes), ops: Number(kv.rios) + Number(kv.wios) })
          }
        } catch {
          // A container that stopped between listing and reading: skip it.
        }
      }),
  )
  try {
    // Logins (SSH sessions) live outside system.slice.
    const text = await readFile(`${CGROUP}/user.slice/io.stat`, "utf-8")
    for (const line of text.split("\n")) {
      if (!line.startsWith(`${majMin} `)) continue
      const kv = Object.fromEntries(line.split(" ").slice(1).map((x) => x.split("=")))
      totals.set("user.slice", { bytes: Number(kv.rbytes) + Number(kv.wbytes), ops: Number(kv.rios) + Number(kv.wios) })
    }
  } catch {
    // No login sessions at the moment: nothing to add.
  }
  return totals
}

export async function sampleCulprits(majMin: string | null): Promise<DiskCulprits | null> {
  if (!majMin) return null
  const now = Date.now()
  snaps.push({ t: now, totals: await readTotals(majMin) })
  while (snaps.length > 1 && now - snaps[0].t > WINDOW_MS * 1.5) snaps.shift()

  // The baseline is the oldest reading that is at least a few seconds old (but within the window).
  const baseline = snaps.find((s) => now - s.t <= WINDOW_MS && now - s.t >= 2_000)
  if (!baseline) return { warming: true, quiet: true, items: [] }
  const current = snaps[snaps.length - 1]
  const seconds = (current.t - baseline.t) / 1000
  const names = await idMap()

  const items: Culprit[] = []
  let totalOps = 0
  for (const [key, cur] of current.totals) {
    const base = baseline.totals.get(key)
    if (!base) continue
    const ops = Math.max(0, cur.ops - base.ops) / seconds
    const kb = Math.max(0, cur.bytes - base.bytes) / 1024 / seconds
    totalOps += ops
    if (ops < 0.3 && kb < 4) continue
    const name = key.startsWith("docker-") ? (names.get(key.slice("docker-".length, -".scope".length)) ?? `container ${key.slice(7, 19)}`) : (SERVICE_LABELS[key] ?? key.replace(".service", ""))
    items.push({ name, opsPerSec: Math.round(ops * 10) / 10, kbPerSec: Math.round(kb) })
  }
  items.sort((a, b) => b.opsPerSec - a.opsPerSec || b.kbPerSec - a.kbPerSec)
  return { warming: false, quiet: totalOps < 1, items: items.slice(0, 3) }
}
