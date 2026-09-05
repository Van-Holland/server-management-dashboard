"use client"

import { useMemo, useState } from "react"
import {
  Clapperboard,
  Images,
  Tv,
  Film,
  Captions,
  Search,
  Download,
  Ticket,
  CloudDownload,
  Music,
  Disc3,
  Share2,
  Wallet,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react"

type App = {
  name: string
  description: string
  href: string
  icon: LucideIcon
}

type Group = {
  title: string
  apps: App[]
}

// Tailscale IP:port for each service — matches the ports confirmed live via
// `docker ps` on mulderserver. Raw IP:port, no per-app hostnames — deliberate
// choice, same as the rest of the homelab (see instructions.md).
//
// ONE EXCEPTION, added 2026-09-05: Actual Budget cannot use this and carries its
// own full URL below. It needs SharedArrayBuffer, which browsers only expose in
// a secure context, so plain http://IP:port kills the app at startup. It is
// served over HTTPS by `tailscale serve` instead. If a second service ever
// needs this, stop special-casing and give every tile a full `href`.
const TS_IP = "100.69.6.89"

const groups: Group[] = [
  {
    title: "Media",
    apps: [
      { name: "Jellyfin", description: "Media server", href: `http://${TS_IP}:8096`, icon: Clapperboard },
      { name: "Immich", description: "Photos & videos", href: `http://${TS_IP}:2283`, icon: Images },
      { name: "Navidrome", description: "Music streaming", href: `http://${TS_IP}:4533`, icon: Music },
    ],
  },
  {
    title: "Automation",
    apps: [
      { name: "Sonarr", description: "TV shows", href: `http://${TS_IP}:8989`, icon: Tv },
      { name: "Radarr", description: "Movies", href: `http://${TS_IP}:7878`, icon: Film },
      { name: "Bazarr", description: "Subtitles", href: `http://${TS_IP}:6767`, icon: Captions },
      { name: "Lidarr", description: "Music", href: `http://${TS_IP}:8686`, icon: Disc3 },
      { name: "Prowlarr", description: "Indexers", href: `http://${TS_IP}:9696`, icon: Search },
    ],
  },
  {
    title: "Downloads",
    apps: [
      { name: "qBittorrent", description: "Torrent client", href: `http://${TS_IP}:8080`, icon: Download },
      { name: "SABnzbd", description: "Usenet client", href: `http://${TS_IP}:8081`, icon: CloudDownload },
      // slskd's web UI is published by gluetun, not by slskd's own compose — it
      // shares gluetun's network namespace. Port 5030 all the same.
      { name: "slskd", description: "Soulseek client", href: `http://${TS_IP}:5030`, icon: Share2 },
      { name: "Jellyseerr", description: "Media requests", href: `http://${TS_IP}:5055`, icon: Ticket },
    ],
  },
  {
    title: "Finance",
    apps: [
      // Full HTTPS URL on purpose — NOT `http://${TS_IP}:5006`. See the note on
      // TS_IP above: on plain HTTP this app fails to start entirely. Still
      // tailnet-only; `tailscale serve` terminates TLS on the tailnet.
      {
        name: "Actual Budget",
        description: "Personal finance",
        href: "https://mulderserver.taild9b5b8.ts.net",
        icon: Wallet,
      },
    ],
  },
]

function AppTile({ app }: { app: App }) {
  const Icon = app.icon
  return (
    <a
      href={app.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="flex size-12 items-center justify-center rounded-lg bg-secondary text-foreground transition-colors group-hover:bg-brand group-hover:text-brand-foreground">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <div>
        <div className="flex items-center gap-1">
          <p className="font-medium text-foreground">{app.name}</p>
          <ArrowUpRight
            className="size-3.5 text-brand opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        </div>
        <p className="text-sm text-muted-foreground">{app.description}</p>
      </div>
    </a>
  )
}

export function AppsSection() {
  const [query, setQuery] = useState("")

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map((group) => ({
        ...group,
        apps: group.apps.filter(
          (app) =>
            app.name.toLowerCase().includes(q) || app.description.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.apps.length > 0)
  }, [query])

  return (
    <div className="flex flex-col gap-8">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search applications..."
          aria-label="Search applications"
          className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        />
      </div>

      {filteredGroups.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No applications match {`"${query}"`}
        </p>
      ) : (
        filteredGroups.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {group.apps.map((app) => (
                <AppTile key={app.name} app={app} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
