import Link from "next/link"
import {
  ArrowUpRight,
  Captions,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  CloudDownload,
  Disc3,
  Download,
  Dumbbell,
  Film,
  Images,
  LayoutGrid,
  Music,
  Search,
  Share2,
  Ticket,
  Tv,
  type LucideIcon,
} from "lucide-react"

/**
 * The home page's apps, sorted by how often they are opened, not by what kind
 * of software they are. Redesigned 2026-10-19: the old layout grouped by type
 * (Media / Automation / Downloads) and gave Prowlarr the same big tile as
 * Jellyfin, so rarely-opened tools sat on top of the things used every day.
 *
 *  - Every day: big tiles. Which apps are "every day" is a judgement about this
 *    household's habits, not something the code can know; change DAILY to move one.
 *  - Behind the scenes: closed by default, plain links. They still work, they
 *    just stop competing for the top of the page.
 */

// Tailscale IP:port for each service. Raw IP:port, no per-app hostnames
// (deliberate, see instructions.md). If a service ever needs HTTPS, give that
// tile its own full `href`.
const TS_IP = "100.69.6.89"

type Tile = {
  name: string
  description: string
  /** External apps open in a new tab; an internal page (starts with "/") does not. */
  href: string
  icon: LucideIcon
  /** The icon's own colour, so each daily app is recognisable without reading. */
  tint: string
}

const DAILY: Tile[] = [
  { name: "Jellyfin", description: "Watch films and shows", href: `http://${TS_IP}:8096`, icon: Clapperboard, tint: "bg-[#6d4fd8]" },
  { name: "Jellyseerr", description: "Request something new", href: `http://${TS_IP}:5055`, icon: Ticket, tint: "bg-[#2f7de1]" },
  { name: "Immich", description: "Photos and videos", href: `http://${TS_IP}:2283`, icon: Images, tint: "bg-[#d4537e]" },
  { name: "Navidrome", description: "Music", href: `http://${TS_IP}:4533`, icon: Music, tint: "bg-[#1d9e75]" },
  // Plain IP:port (2026-10-19): with Tailscale DNS on, the phone lost its internet,
  // so the app also answers on 3011. The HTTPS name on :8443 still works, but only
  // the IP address works with Tailscale DNS switched off.
  { name: "Fitness Tracker", description: "Training log", href: `http://${TS_IP}:3011`, icon: Dumbbell, tint: "bg-[#ba7517]" },
  { name: "Media library", description: "What is on the server", href: "/media", icon: LayoutGrid, tint: "bg-[#4b4b53]" },
]

type Tool = { name: string; href: string; icon: LucideIcon }
type ToolGroup = { title: string; tools: Tool[] }

const TOOLS: ToolGroup[] = [
  {
    title: "Find and manage",
    tools: [
      { name: "Sonarr", href: `http://${TS_IP}:8989`, icon: Tv },
      { name: "Radarr", href: `http://${TS_IP}:7878`, icon: Film },
      { name: "Lidarr", href: `http://${TS_IP}:8686`, icon: Disc3 },
      { name: "Bazarr", href: `http://${TS_IP}:6767`, icon: Captions },
      { name: "Prowlarr", href: `http://${TS_IP}:9696`, icon: Search },
    ],
  },
  {
    title: "Download clients",
    tools: [
      { name: "qBittorrent", href: `http://${TS_IP}:8080`, icon: Download },
      { name: "SABnzbd", href: `http://${TS_IP}:8081`, icon: CloudDownload },
      // slskd's web UI is published by gluetun, not by slskd's own compose: it
      // shares gluetun's network namespace. Port 5030 all the same.
      { name: "slskd", href: `http://${TS_IP}:5030`, icon: Share2 },
    ],
  },
]

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

function DailyTile({ tile }: { tile: Tile }) {
  const Icon = tile.icon
  const internal = tile.href.startsWith("/")
  const className = `group flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-brand ${focusRing}`
  const body = (
    <>
      <span className={`flex size-12 items-center justify-center rounded-xl text-white ${tile.tint}`}>
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <div>
        <div className="flex items-center gap-1">
          <p className="text-base font-medium text-foreground">{tile.name}</p>
          {!internal && (
            <ArrowUpRight
              className="size-3.5 text-brand opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden="true"
            />
          )}
        </div>
        <p className="text-sm text-muted-foreground">{tile.description}</p>
      </div>
    </>
  )

  return internal ? (
    <Link href={tile.href} className={className}>
      {body}
    </Link>
  ) : (
    <a href={tile.href} target="_blank" rel="noopener noreferrer" className={className}>
      {body}
    </a>
  )
}

export function DailyApps() {
  return (
    <section aria-labelledby="daily-heading">
      <h2 id="daily-heading" className="mb-3 text-sm font-medium text-muted-foreground">
        Every day
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {DAILY.map((tile) => (
          <DailyTile key={tile.name} tile={tile} />
        ))}
      </div>
    </section>
  )
}

/**
 * Closed by default. Built on <details>, like the Media page's disclosure, so it
 * needs no client JavaScript and the browser handles keyboard and toggling.
 * Two icons swapped with `group-open:` rather than one rotated: `rotate-90` does
 * not take effect in this project (see app/media history).
 */
export function ToolsSection() {
  const count = TOOLS.reduce((n, g) => n + g.tools.length, 0)

  return (
    <details className="group">
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 rounded-lg py-1 text-sm text-muted-foreground transition-colors hover:text-foreground ${focusRing} [&::-webkit-details-marker]:hidden`}
      >
        <ChevronRight className="size-4 group-open:hidden" aria-hidden="true" />
        <ChevronDown className="hidden size-4 group-open:block" aria-hidden="true" />
        <span className="font-medium">Behind the scenes</span>
        <span className="text-xs">{count} tools, rarely opened</span>
      </summary>

      <div className="mt-3 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {TOOLS.map((group) => (
          <div key={group.title}>
            <p className="mb-1 text-xs text-muted-foreground">{group.title}</p>
            <ul>
              {group.tools.map((tool) => {
                const Icon = tool.icon
                return (
                  <li key={tool.name}>
                    <a
                      href={tool.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-foreground transition-colors hover:bg-secondary ${focusRing}`}
                    >
                      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                      {tool.name}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </details>
  )
}
