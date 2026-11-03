import { TS_IP } from "@/lib/apps"

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * The app links in lib/apps.ts all point at the Tailscale IP. When the dashboard was opened on another
 * IP address (the home-network address, for example when the internet is down), the links should use
 * that same address, so every button works from wherever the page was opened (2026-11-03).
 *
 * Any host that is not a plain IPv4 address (a name like mulderserver.ts.net) is left alone.
 */
export function followHost(href: string): string {
  if (typeof window === "undefined") return href
  const host = window.location.hostname
  if (host === TS_IP || !IPV4.test(host)) return href
  const prefix = `http://${TS_IP}:`
  return href.startsWith(prefix) ? `http://${host}:${href.slice(prefix.length)}` : href
}
