"use client"

import { useEffect, useRef } from "react"

/**
 * A soft light, in the app's own colour, that follows the cursor across a tile.
 *
 * Drop it inside a `relative overflow-hidden` element that also has `group` and
 * sets `--tint`. It listens on its parent, so the tile itself can stay a plain
 * server-rendered link. Pure decoration for a hover, so it is hidden from
 * assistive tech and ignores the pointer.
 */
export function Spotlight() {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const host = ref.current?.parentElement
    if (!host) return
    const move = (event: PointerEvent) => {
      const box = host.getBoundingClientRect()
      host.style.setProperty("--mx", `${event.clientX - box.left}px`)
      host.style.setProperty("--my", `${event.clientY - box.top}px`)
    }
    // The light behind the whole page takes this app's colour while it is hovered.
    const root = document.documentElement
    const enter = () => {
      root.style.setProperty("--ambient", getComputedStyle(host).getPropertyValue("--tint"))
      root.dataset.ambient = "on"
    }
    const leave = () => {
      delete root.dataset.ambient
      root.style.removeProperty("--ambient")
    }
    host.addEventListener("pointermove", move)
    host.addEventListener("pointerenter", enter)
    host.addEventListener("pointerleave", leave)
    return () => {
      host.removeEventListener("pointermove", move)
      host.removeEventListener("pointerenter", enter)
      host.removeEventListener("pointerleave", leave)
      leave()
    }
  }, [])

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      style={{
        background:
          "radial-gradient(220px circle at var(--mx, 50%) var(--my, 0%), color-mix(in srgb, var(--tint) 22%, transparent), transparent 70%)",
      }}
    />
  )
}
