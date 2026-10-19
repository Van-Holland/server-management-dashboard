"use client"

import { useEffect, useRef } from "react"

/**
 * Makes the light behind the whole page take an app's colour while that app is
 * hovered or focused.
 *
 * Drop it inside the app's link, which must set `--tint`. It listens on its parent
 * so the link itself can stay a plain server-rendered anchor. It draws nothing:
 * the glow is the page-wide `.ambient` layer (see globals.css and
 * components/ambient-glow.tsx), and it answers the cursor, so it is not decoration.
 */
export function AmbientTrigger() {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const host = ref.current?.parentElement
    if (!host) return
    const root = document.documentElement
    const enter = () => {
      root.style.setProperty("--ambient", getComputedStyle(host).getPropertyValue("--tint"))
      root.dataset.ambient = "on"
    }
    const leave = () => {
      delete root.dataset.ambient
      root.style.removeProperty("--ambient")
    }
    host.addEventListener("pointerenter", enter)
    host.addEventListener("pointerleave", leave)
    host.addEventListener("focus", enter)
    host.addEventListener("blur", leave)
    return () => {
      host.removeEventListener("pointerenter", enter)
      host.removeEventListener("pointerleave", leave)
      host.removeEventListener("focus", enter)
      host.removeEventListener("blur", leave)
      leave()
    }
  }, [])

  return <span ref={ref} aria-hidden="true" className="hidden" />
}
