"use client"

import { useEffect, useRef } from "react"

/**
 * A slow, faint constellation behind every page: soft blue stars drift, close ones
 * are joined by very thin lines, and the cursor (or a finger) gently pushes nearby
 * stars away. The push is eased in and out and stars carry it as momentum that
 * fades on its own, so nothing ever snaps to or jerks away from the pointer.
 * Purely visual, so it never takes a click and is hidden from screen readers.
 *
 * Kept cheap on purpose: a few dozen stars, no library, 30 fps on a phone, stopped
 * while the tab is hidden, and a single still frame when the visitor asked for
 * reduced motion.
 */

// ox/oy is the extra velocity from the pointer's push; it decays on its own.
type Star = { x: number; y: number; vx: number; vy: number; ox: number; oy: number; r: number; a: number }

const BLUE = "128, 178, 255" // soft sky blue

/** One soft star, drawn once: a bright small core fading smoothly into a blue halo. */
function makeSprite(): HTMLCanvasElement {
  const size = 64
  const sprite = document.createElement("canvas")
  sprite.width = size
  sprite.height = size
  const g = sprite.getContext("2d")
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, "rgba(225, 238, 255, 1)")
    grad.addColorStop(0.12, "rgba(170, 207, 255, 0.95)")
    grad.addColorStop(0.3, `rgba(${BLUE}, 0.5)`)
    grad.addColorStop(0.6, `rgba(${BLUE}, 0.16)`)
    grad.addColorStop(1, `rgba(${BLUE}, 0)`)
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
  }
  return sprite
}

export function Constellation() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const small = window.matchMedia("(max-width: 640px)").matches
    const frameMs = small ? 1000 / 30 : 1000 / 60
    const linkDist = small ? 85 : 105
    const pointerRadius = small ? 100 : 130

    const sprite = makeSprite()
    let w = 0
    let h = 0
    let stars: Star[] = []
    // tx/ty is where the pointer really is; x/y trail it, and `power` eases between
    // 0 and 1, so the push fades in and out instead of jerking the stars.
    const pointer = { x: 0, y: 0, tx: 0, ty: 0, on: false, power: 0 }

    const seed = () => {
      const count = Math.max(26, Math.min(80, Math.round((w * h) / (small ? 10000 : 15000))))
      stars = Array.from({ length: count }, () => {
        const speed = 0.03 + Math.random() * 0.07 // px per frame: a few px per second
        const angle = Math.random() * Math.PI * 2
        const big = Math.random() < 0.15
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          ox: 0,
          oy: 0,
          // r is the visible core; the glow around it is drawn at about 7x that.
          r: big ? 2.2 + Math.random() * 1.2 : 1.1 + Math.random() * 1.0,
          a: big ? 0.9 + Math.random() * 0.1 : 0.5 + Math.random() * 0.4,
        }
      })
    }

    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      ctx.lineWidth = 0.5
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i]
        for (let j = i + 1; j < stars.length; j++) {
          const t = stars[j]
          const d = Math.hypot(s.x - t.x, s.y - t.y)
          if (d < linkDist) {
            ctx.strokeStyle = `rgba(${BLUE}, ${(1 - d / linkDist) * 0.12})`
            ctx.beginPath()
            ctx.moveTo(s.x, s.y)
            ctx.lineTo(t.x, t.y)
            ctx.stroke()
          }
        }
      }
      for (const s of stars) {
        const d = s.r * 7.5
        ctx.globalAlpha = s.a
        ctx.drawImage(sprite, s.x - d / 2, s.y - d / 2, d, d)
      }
      ctx.globalAlpha = 1
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

    const step = () => {
      pointer.power += ((pointer.on ? 1 : 0) - pointer.power) * 0.04
      pointer.x += (pointer.tx - pointer.x) * 0.08
      pointer.y += (pointer.ty - pointer.y) * 0.08

      for (const s of stars) {
        if (pointer.power > 0.01) {
          const dx = s.x - pointer.x
          const dy = s.y - pointer.y
          const d = Math.hypot(dx, dy)
          // A very soft push away from the pointer, strongest close in, zero at the edge.
          if (d < pointerRadius && d > 0.5) {
            const push = (1 - d / pointerRadius) ** 2 * 0.012 * pointer.power
            s.ox += (dx / d) * push
            s.oy += (dy / d) * push
          }
        }
        s.ox *= 0.975
        s.oy *= 0.975
        s.x += s.vx + s.ox
        s.y += s.vy + s.oy
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
      pointer.tx = e.clientX
      pointer.ty = e.clientY
      if (!pointer.on && pointer.power < 0.05) {
        // Coming in from outside: start the trailing point at the cursor, not at the last place it was.
        pointer.x = e.clientX
        pointer.y = e.clientY
      }
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
