import { createHmac, scryptSync, timingSafeEqual } from "node:crypto"

/**
 * One shared password for the whole dashboard (added 2026-11-04).
 *
 * Nothing secret lives in the code. Three values come from the server's .env:
 *   AUTH_PASSWORD_HASH  the password, scrambled one way (made by scripts/hash-password.mjs)
 *   AUTH_SECRET         random text that signs the login cookie, so it cannot be faked
 *   CRON_TOKEN          lets the server's own 5-minute cron job call /api/health/record
 * If AUTH_PASSWORD_HASH or AUTH_SECRET is missing, nobody gets in. Failing shut is deliberate.
 */

export const SESSION_COOKIE = "ms_session"
export const SESSION_DAYS = 30
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000

const secret = () => process.env.AUTH_SECRET ?? ""
export const authConfigured = () => secret().length >= 32 && Boolean(process.env.AUTH_PASSWORD_HASH)

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("hex")

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** A cookie value: the moment it stops working, then a signature over that moment. */
export function makeSession(now = Date.now()): string {
  const expires = String(now + SESSION_MS)
  return `${expires}.${sign(expires)}`
}

export function sessionValid(token: string | undefined, now = Date.now()): boolean {
  if (!token || !authConfigured()) return false
  const [expires, signature] = token.split(".")
  if (!expires || !signature || !/^\d+$/.test(expires)) return false
  return safeEqual(signature, sign(expires)) && Number(expires) > now
}

/** Stored as `scrypt:<salt hex>:<hash hex>`. Colons, not dollar signs, so docker compose leaves it alone. */
export function passwordMatches(password: string): boolean {
  const [kind, salt, hash] = (process.env.AUTH_PASSWORD_HASH ?? "").split(":")
  if (kind !== "scrypt" || !salt || !hash) return false
  const made = scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex")
  return safeEqual(made, hash)
}

export function cronTokenValid(token: string | null): boolean {
  const expected = process.env.CRON_TOKEN ?? ""
  return expected.length >= 24 && token !== null && safeEqual(token, expected)
}

/** Only ever send people to a page on this site after logging in. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/"
}

// Too many wrong guesses and the door shuts for a minute. It counts all guesses together, not per person:
// behind Docker the dashboard cannot tell visitors apart reliably.
const MAX_FAILS = 5
const WINDOW_MS = 10 * 60 * 1000
const LOCK_MS = 60 * 1000
let fails: number[] = []
let lockedUntil = 0

export function lockedFor(now = Date.now()): number {
  return Math.max(0, Math.ceil((lockedUntil - now) / 1000))
}
export function recordFail(now = Date.now()) {
  fails = fails.filter((t) => now - t < WINDOW_MS)
  fails.push(now)
  if (fails.length >= MAX_FAILS) {
    lockedUntil = now + LOCK_MS
    fails = []
  }
}
export function recordSuccess() {
  fails = []
}
