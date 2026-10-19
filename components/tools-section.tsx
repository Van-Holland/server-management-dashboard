"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { TOOLS } from "@/lib/apps"

/**
 * The Tools list, closed by default, that slides open instead of jumping.
 *
 * A native <details> cannot animate its height, so this is a button plus a grid
 * whose row height moves from 0fr to 1fr (see .disclosure in globals.css), which
 * is the one way to animate "auto" height with plain CSS. While closed the list
 * is `inert`, so keyboard focus and screen readers skip links that cannot be seen.
 */

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

export function ToolsSection() {
  const [open, setOpen] = useState(false)

  return (
    <section aria-labelledby="tools-heading">
      <h2 id="tools-heading" className="sr-only">
        Tools
      </h2>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="tools-list"
        className={`flex items-center gap-2 rounded-lg py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground ${focusRing}`}
      >
        <ChevronDown
          className={`size-4 transition-transform duration-500 ease-out ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
        Tools
      </button>

      <div id="tools-list" className="disclosure" data-open={open} inert={!open}>
        <div>
          <div className="grid gap-x-10 gap-y-5 pt-3 sm:grid-cols-[repeat(2,minmax(0,22rem))]">
            {TOOLS.map((group) => (
              <div key={group.title}>
                <p className="mb-1 px-2 text-xs text-muted-foreground">{group.title}</p>
                <ul>
                  {group.tools.map((tool, index) => (
                    <li key={tool.name} className="disclosure-item" style={{ "--n": index } as React.CSSProperties}>
                      <a
                        href={tool.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-foreground transition-colors hover:bg-secondary ${focusRing}`}
                      >
                        <img
                          src={`/logos/${tool.logo}.svg`}
                          alt=""
                          width={18}
                          height={18}
                          className="size-[18px] shrink-0 object-contain"
                        />
                        {tool.name}
                        <span className="ml-auto text-xs text-muted-foreground">{tool.description}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
