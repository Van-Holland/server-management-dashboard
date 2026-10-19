import type { CSSProperties } from "react"
import { ArrowUpRight, Dumbbell } from "lucide-react"
import { Spotlight } from "@/components/spotlight"
import { DAILY, type AppEntry } from "@/lib/apps"

/**
 * "Your apps": the apps used every day, as big tiles that are all logo. The
 * description line was dropped on purpose (2026-10-19): a name and a recognisable
 * mark say enough, and the freed space is what lets the logos be large. The
 * description still shows in the tooltip and in the Cmd+K launcher.
 *
 * Only apps you USE live here; Media library and Backups are things you CHECK and
 * sit under Server. The list itself is in lib/apps.ts.
 */

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

function DailyTile({ app, index }: { app: AppEntry; index: number }) {
  return (
    <a
      href={app.href}
      target="_blank"
      rel="noopener noreferrer"
      title={app.description}
      style={{ "--tint": app.tint, "--i": index } as CSSProperties}
      className={`tile panel enter group relative flex min-h-[9.5rem] flex-col justify-between overflow-hidden rounded-[22px] p-4 sm:min-h-[11.5rem] sm:p-5 ${focusRing}`}
    >
      <Spotlight />

      {/* A pane of glass for the mark to sit on. */}
      <span className="relative flex size-16 items-center justify-center rounded-[20px] bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,240,220,0.07),inset_0_0_0_1px_rgba(255,240,220,0.04)] sm:size-[4.75rem]">
        {app.logo ? (
          <img
            src={`/logos/${app.logo}.svg`}
            alt=""
            width={44}
            height={44}
            className="logo-img size-9 object-contain sm:size-11"
          />
        ) : (
          <Dumbbell className="logo-img size-8 sm:size-10" style={{ color: app.tint }} aria-hidden="true" />
        )}
      </span>

      <div className="relative flex items-end justify-between gap-2">
        <p className="text-base font-medium tracking-tight text-foreground sm:text-lg">{app.name}</p>
        <ArrowUpRight
          className="mb-1 size-4 shrink-0 text-brand opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </div>
    </a>
  )
}

export function DailyApps() {
  return (
    <section aria-labelledby="daily-heading">
      <h2 id="daily-heading" className="mb-3 text-sm font-medium text-muted-foreground">
        Your apps
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
        {DAILY.map((app, index) => (
          <DailyTile key={app.name} app={app} index={index} />
        ))}
      </div>
    </section>
  )
}
