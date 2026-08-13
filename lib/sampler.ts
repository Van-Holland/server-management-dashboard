import { diskIoRates, sampleDiskstats, type DiskIoRates } from "@/lib/disk-io"
import { networkRates, sampleNetDev, type NetworkRates } from "@/lib/network-stats"
import { cpuRate, sampleCpu } from "@/lib/system-stats"

export type LiveRates = {
  cpu: number
  network: NetworkRates
  diskIo: DiskIoRates
}

// CPU %, network throughput and disk throughput are all deltas between two
// readings. They share ONE sampling window rather than each sleeping separately —
// three metrics for the cost of the slowest one.
const SAMPLE_MS = 500

export async function sampleLiveRates(): Promise<LiveRates> {
  const [cpuFirst, netFirst, diskFirst] = await Promise.all([
    sampleCpu(),
    sampleNetDev(),
    sampleDiskstats(),
  ])

  await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS))

  const [cpuSecond, netSecond, diskSecond] = await Promise.all([
    sampleCpu(),
    sampleNetDev(),
    sampleDiskstats(),
  ])

  const elapsedSeconds = SAMPLE_MS / 1000
  return {
    cpu: cpuRate(cpuFirst, cpuSecond),
    network: networkRates(netFirst, netSecond, elapsedSeconds),
    diskIo: await diskIoRates(diskFirst, diskSecond, elapsedSeconds),
  }
}
