"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"

/** Copies a piece of text and says so. Used for the summary to show Ziggo. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle")

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setState("done")
    } catch {
      setState("failed")
    }
    setTimeout(() => setState("idle"), 2500)
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/70"
    >
      {state === "done" ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      {state === "done" ? "Copied" : state === "failed" ? "Could not copy: select the text below" : label}
    </button>
  )
}
