/**
 * Every app and page the home page and the Cmd+K launcher know about.
 *
 * One list, two readers: the tiles and tool rows on the home page, and the
 * launcher's search. Keeping it here means an app added in one place appears in
 * both, and the launcher can still find an app by what it does ("films", "photos")
 * even though the big tiles no longer print that description.
 *
 * The logos are the projects' own marks, from the Apache-2.0 icon set
 * homarr-labs/dashboard-icons, saved in public/logos/ (downloaded 2026-10-19).
 * Fitness Tracker is this household's own app and has no public mark.
 */

// Tailscale IP:port for each service. Raw IP:port, no per-app hostnames
// (deliberate, see instructions.md). If a service ever needs HTTPS, give that
// entry its own full `href`.
const TS_IP = "100.69.6.89"

export type AppEntry = {
  name: string
  /** What it does, in a few words. Shown in the launcher and the tool rows, not on the big tiles. */
  description: string
  /** External apps start with http and open in a new tab; internal pages start with "/". */
  href: string
  /** File in public/logos/ (without .svg), or null for an app without a public mark. */
  logo: string | null
  /** The colour of the light under the cursor and of the hover border. */
  tint: string
  /** Extra words the launcher matches on. */
  keywords: string[]
}

/** The apps you USE. Which ones belong here is a judgement about this household's habits. */
export const DAILY: AppEntry[] = [
  { name: "Jellyfin", description: "Watch films and shows", href: `http://${TS_IP}:8096`, logo: "jellyfin", tint: "#8b6cf0", keywords: ["movies", "tv", "stream", "watch", "kids"] },
  { name: "Immich", description: "Photos and videos", href: `http://${TS_IP}:2283`, logo: "immich", tint: "#e0568a", keywords: ["pictures", "camera", "gallery"] },
  { name: "Navidrome", description: "Music", href: `http://${TS_IP}:4533`, logo: "navidrome", tint: "#3b82f6", keywords: ["songs", "albums", "listen"] },
  // Plain IP:port (2026-10-19): with Tailscale DNS on, the phone lost its internet,
  // so the app also answers on 3011. The HTTPS name on :8443 still works, but only
  // the IP address works with Tailscale DNS switched off.
  { name: "Fitness Tracker", description: "Training log", href: `http://${TS_IP}:3011`, logo: null, tint: "#b9772a", keywords: ["workout", "gym", "weight", "training"] },
]

/**
 * The "Finders" folder (2026-10-20): the apps you use to GET new things into the library. Jellyseerr is a request box for films and
 * shows, Lidarr is a wish list for albums, slskd is a search tool for rare music. They moved here from "Your apps" and the Tools
 * list, so the home page keeps five icons and the Tools list keeps only the machinery.
 */
export const FINDERS: AppEntry[] = [
  { name: "Jellyseerr", description: "Films and shows", href: `http://${TS_IP}:5055`, logo: "jellyseerr", tint: "#7c6cf0", keywords: ["request", "add", "movies", "shows", "ask"] },
  { name: "Lidarr", description: "Albums, from Usenet and torrents", href: `http://${TS_IP}:8686`, logo: "lidarr", tint: "#00a65b", keywords: ["music", "albums", "artists", "wish list"] },
  // slskd's web UI is published by gluetun, not by slskd's own compose: it shares gluetun's network namespace. Port 5030 all the same.
  { name: "slskd", description: "Rare music, from Soulseek", href: `http://${TS_IP}:5030`, logo: "slskd", tint: "#3b82f6", keywords: ["soulseek", "music", "dj", "rare", "search"] },
]

export type ToolEntry = AppEntry
export type ToolGroup = { title: string; tools: ToolEntry[] }

export const TOOLS: ToolGroup[] = [
  {
    // "Arr stack" is Matthijs's name for Sonarr, Radarr, Lidarr, Bazarr and Prowlarr. Lidarr moved to the Finders folder.
    title: "Arr stack",
    tools: [
      { name: "Sonarr", description: "TV shows", href: `http://${TS_IP}:8989`, logo: "sonarr", tint: "#35c5f4", keywords: ["series", "tv"] },
      { name: "Radarr", description: "Films", href: `http://${TS_IP}:7878`, logo: "radarr", tint: "#ffc230", keywords: ["movies"] },
      { name: "Bazarr", description: "Subtitles", href: `http://${TS_IP}:6767`, logo: "bazarr", tint: "#a8a8a8", keywords: ["subs", "captions"] },
      { name: "Prowlarr", description: "Search sources", href: `http://${TS_IP}:9696`, logo: "prowlarr", tint: "#f97316", keywords: ["indexers", "nzbgeek"] },
    ],
  },
  {
    title: "Downloaders",
    tools: [
      { name: "qBittorrent", description: "Torrent downloads", href: `http://${TS_IP}:8080`, logo: "qbittorrent", tint: "#4a90e2", keywords: ["torrents", "vpn"] },
      { name: "SABnzbd", description: "Usenet downloads", href: `http://${TS_IP}:8081`, logo: "sabnzbd", tint: "#ffcc00", keywords: ["nzb", "usenet"] },
    ],
  },
]

/** The dashboard's own pages, for the launcher. */
export const PAGES: Omit<AppEntry, "logo" | "tint">[] = [
  { name: "Home", description: "The dashboard", href: "/", keywords: ["start", "overview"] },
  { name: "Media library", description: "What is on the server", href: "/media", keywords: ["films", "shows", "delete", "quality", "thin"] },
  { name: "Backups", description: "Is everything safe", href: "/backups", keywords: ["restore", "copies", "time machine", "proton"] },
]
