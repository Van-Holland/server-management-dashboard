"use client"

import { usePathname } from "next/navigation"

/** Keeps the app search and link fixer off the login page, so the app list is not shown to someone not logged in. */
export function HideOnLogin({ children }: { children: React.ReactNode }) {
  return usePathname() === "/login" ? null : <>{children}</>
}
