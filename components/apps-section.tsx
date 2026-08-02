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
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react"

type App = {
  name: string
  description: string
  href: string
  icon: LucideIcon
  online: boolean
}

type Group = {
  title: string
  apps: App[]
}

const groups: Group[] = [
  {
    title: "Media",
    apps: [
      { name: "Jellyfin", description: "Media server", href: "#", icon: Clapperboard, online: true },
      { name: "Immich", description: "Photos & videos", href: "#", icon: Images, online: true },
    ],
  },
  {
    title: "Automation",
    apps: [
      { name: "Sonarr", description: "TV shows", href: "#", icon: Tv, online: true },
      { name: "Radarr", description: "Movies", href: "#", icon: Film, online: true },
      { name: "Bazarr", description: "Subtitles", href: "#", icon: Captions, online: false },
      { name: "Prowlarr", description: "Indexers", href: "#", icon: Search, online: true },
    ],
  },
  {
    title: "Downloads",
    apps: [
      { name: "qBittorrent", description: "Torrent client", href: "#", icon: Download, online: true },
      { name: "SABnzbd", description: "Usenet client", href: "#", icon: CloudDownload, online: true },
      { name: "Jellyseerr", description: "Media requests", href: "#", icon: Ticket, online: false },
    ],
  },
]

function AppTile({ app }: { app: App }) {
  const Icon = app.icon
  return (
    <a
      href={app.href}
      className="group relative flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span
        className={`absolute right-4 top-4 size-2 rounded-full ${app.online ? "bg-status-online" : "bg-status-offline"}`}
        aria-hidden="true"
      />
      <span className="sr-only">{app.online ? "Online" : "Offline"}</span>
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
