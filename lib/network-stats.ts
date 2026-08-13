import { readFile } from "node:fs/promises"

export type NetworkRates = {
  rxBytesPerSec: number
  txBytesPerSec: number
  rxTotalBytes: number
  txTotalBytes: number
  interfaces: string[]
}

// /proc/net is per-network-namespace, so reading /host/proc/net/dev from inside
// a container returns the CONTAINER's interfaces (just lo and eth0) even though
// the host's /proc is mounted. PID 1 is the host's init, and /proc/1/net resolves
// in its namespace — which is the host's. /proc/stat, /proc/meminfo and
// /proc/diskstats need no such treatment because they're global.
const NET_DEV_PATH = "/host/proc/1/net/dev"

// Interfaces that don't represent traffic entering or leaving the machine:
// loopback, Docker's bridges and veth pairs (container-to-container only), and
// tailscale0 — Tailscale traffic is encapsulated inside the physical NIC's
// counters, so adding it would double-count every remote byte.
const VIRTUAL_IFACE = /^(lo|docker\d*|br-.+|veth.+|tailscale\d*|virbr\d*)$/

// Columns after "iface:" are 8 receive fields then 8 transmit fields:
// bytes packets errs drop fifo frame compressed multicast | bytes packets ...
const RX_BYTES = 0
const TX_BYTES = 8

export type NetSample = { rx: number; tx: number; names: string[] }

export async function sampleNetDev(): Promise<NetSample> {
  const raw = await readFile(NET_DEV_PATH, "utf-8")
  let rx = 0
  let tx = 0
  const names: string[] = []

  // First two lines are the two-row header.
  for (const line of raw.split("\n").slice(2)) {
    const [rawName, rawCounters] = line.split(":")
    if (!rawName || !rawCounters) continue

    const name = rawName.trim()
    if (VIRTUAL_IFACE.test(name)) continue

    const counters = rawCounters.trim().split(/\s+/).map(Number)
    if (counters.length < TX_BYTES + 1) continue

    rx += counters[RX_BYTES]
    tx += counters[TX_BYTES]
    names.push(name)
  }

  return { rx, tx, names }
}

export function networkRates(
  first: NetSample,
  second: NetSample,
  elapsedSeconds: number,
): NetworkRates {
  return {
    // Counters reset to zero when an interface goes down; clamp so a reset
    // reads as idle rather than as a huge negative spike.
    rxBytesPerSec: Math.max(0, (second.rx - first.rx) / elapsedSeconds),
    txBytesPerSec: Math.max(0, (second.tx - first.tx) / elapsedSeconds),
    rxTotalBytes: second.rx,
    txTotalBytes: second.tx,
    interfaces: second.names,
  }
}
