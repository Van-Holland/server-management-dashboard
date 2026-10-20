"use client"

import { useEffect, useRef } from "react"

/**
 * A slow, faint constellation behind every page: dim stars drift, close ones are
 * joined by thin lines, and the cursor (or a finger) gently draws nearby stars in.
 * Purely visual, so it never takes a click and is hidden from screen readers.
 *
 * Kept cheap on purpose: a few dozen stars, no library, 30 fps on a phone, stopped
 * while the tab is hidden, and a single still frame when the visitor asked for
 * reduced motion.
 */

type Star = { x: number; y: number; vx: number; vy: number; r: number; a: number; warm: boolean }

const WARM = "232, 150, 80" // the orange of the mark
const COOL = "226, 218, 204" // warm white

export function Constellation() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const small = window.matchMedia("(max-width: 640px)").matches
    const frameMs = small ? 1000 / 30 : 1000 / 60
    const linkDist = small ? 95 : 130
    const pointerRadius = small ? 110 : 150

    let w = 0
    let h = 0
    let stars: Star[] = []
    const pointer = { x: -9999, y: -9999, on: false }

    const seed = () => {
      const count = Math.max(28, Math.min(90, Math.round((w * h) / (small ? 9000 : 13000))))
      stars = Array.from({ length: count }, () => {
        const speed = 0.04 + Math.random() * 0.09 // px per frame: a few px per second
        const angle = Math.random() * Math.PI * 2
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          r: 0.6 + Math.random() * 0.9,
          a: 0.25 + Math.random() * 0.4,
          warm: Math.random() < 0.18,
        }
      })
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed()
      draw()
    }

    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i]
        for (let j = i + 1; j < stars.length; j++) {
          const t = stars[j]
          const dx = s.x - t.x
          const dy = s.y - t.y
          const d = Math.hypot(dx, dy)
          if (d < linkDist) {
            ctx.strokeStyle = `rgba(${COOL}, ${(1 - d / linkDist) * 0.13})`
            ctx.lineWidth = 0.6
            ctx.beginPath()
            ctx.moveTo(s.x, s.y)
            ctx.lineTo(t.x, t.y)
            ctx.stroke()
          }
        }
        if (pointer.on) {
          const d = Math.hypot(s.x - pointer.x, s.y - pointer.y)
          if (d < pointerRadius) {
            ctx.strokeStyle = `rgba(${WARM}, ${(1 - d / pointerRadius) * 0.22})`
            ctx.lineWidth = 0.6
            ctx.beginPath()
            ctx.moveTo(s.x, s.y)
            ctx.lineTo(pointer.x, pointer.y)
            ctx.stroke()
          }
        }
      }
      for (const s of stars) {
        ctx.fillStyle = `rgba(${s.warm ? WARM : COOL}, ${s.a})`
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const step = () => {
      for (const s of stars) {
        if (pointer.on) {
          const dx = pointer.x - s.x
          const dy = pointer.y - s.y
          const d = Math.hypot(dx, dy)
          // A faint pull toward the cursor; it fades to nothing at the edge of the radius.
          if (d < pointerRadius && d > 1) {
            const pull = (1 - d / pointerRadius) * 0.012
            s.x += dx * pull
            s.y += dy * pull
          }
        }
        s.x += s.vx
        s.y += s.vy
        if (s.x < -10) s.x = w + 10
        else if (s.x > w + 10) s.x = -10
        if (s.y < -10) s.y = h + 10
        else if (s.y > h + 10) s.y = -10
      }
    }

    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < frameMs) return
      last = now
      step()
      draw()
    }

    const start = () => {
      if (!reduced && !raf) raf = requestAnimationFrame(loop)
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }

    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
      pointer.on = true
    }
    const onLeave = () => {
      pointer.on = false
    }
    const onVisibility = () => (document.hidden ? stop() : start())

    resize()
    start()
    window.addEventListener("resize", resize)
    window.addEventListener("pointermove", onMove, { passive: true })
    window.addEventListener("pointerup", onLeave)
    document.addEventListener("pointerleave", onLeave)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      window.removeEventListener("resize", resize)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onLeave)
      document.removeEventListener("pointerleave", onLeave)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10" />
}
