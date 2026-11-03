"use client"

import { useEffect } from "react"
import { TS_IP } from "@/lib/apps"
import { followHost } from "@/lib/link-host"

/**
 * Points every app link on the page at the address the dashboard was opened with (see lib/link-host.ts).
 * It also catches links that appear later, like the ones inside the Finders popup.
 */
export function LinkHostRewriter() {
  useEffect(() => {
    const fix = () => {
      document.querySelectorAll<HTMLAnchorElement>(`a[href^="http://${TS_IP}:"]`).forEach((a) => {
        const href = a.getAttribute("href")
        if (href) a.setAttribute("href", followHost(href))
      })
    }
    fix()
    const observer = new MutationObserver(fix)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  return null
}
