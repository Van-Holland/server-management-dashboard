"use client"

import { useRef, useState } from "react"

/**
 * The login page. The stars behind it are the same ones as everywhere else: the root layout draws them.
 * A wrong password shakes the card; the server says what went wrong (wrong, too many tries, not set up).
 */
export default function LoginPage() {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !password) return
    setBusy(true)
    setError("")
    try {
      const next = new URLSearchParams(window.location.search).get("next") ?? "/"
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, next }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        window.location.assign(data.next ?? "/")
        return
      }
      setError(data.error ?? "Something went wrong.")
    } catch {
      setError("Could not reach the server.")
    }
    setPassword("")
    setShake((n) => n + 1)
    setBusy(false)
    input.current?.focus()
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <form
        key={shake}
        onSubmit={submit}
        className={`w-full max-w-[360px] rounded-[20px] border border-border bg-card/80 px-7 py-9 backdrop-blur-md ${shake ? "login-shake" : ""}`}
      >
        <div className="mb-7 flex items-center justify-center gap-3">
          <img src="/logo.png" alt="" aria-hidden="true" width={40} height={40} className="size-10 rounded-[10px]" />
          <h1
            className="text-[28px] leading-none text-foreground/85"
            style={{ fontFamily: "var(--font-name), var(--font-sans)", fontWeight: 400 }}
          >
            mulderserver
          </h1>
        </div>
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <input
          ref={input}
          id="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3 w-full rounded-xl border border-border bg-white/[0.04] px-3.5 py-3 text-foreground outline-none placeholder:text-muted-foreground focus:border-brand focus:ring-[3px] focus:ring-brand/20"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-brand py-3 font-semibold text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Checking…" : "Unlock"}
        </button>
        <p role="alert" className="mt-3 h-4 text-center text-xs text-destructive">
          {error}
        </p>
      </form>
    </main>
  )
}
