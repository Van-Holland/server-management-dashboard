import type { CSSProperties } from "react"
import { Dumbbell } from "lucide-react"
import { AmbientTrigger } from "@/components/ambient-trigger"
import { DAILY, type AppEntry } from "@/lib/apps"

/**
 * "Your apps": the apps used every day, drawn like icons on a phone's home screen:
 * a large logo with its name centred underneath. The description line was dropped
 * on purpose (2026-10-19): a name and a recognisable mark say enough. The
 * description still shows in the tooltip and in the Cmd+K launcher.
 *
 * Only apps you USE live here; Media library and Backups are things you CHECK and
 * sit under Server. The list itself is in lib/apps.ts.
 */

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

/**
 * One app, drawn like an icon on a phone's home screen: the mark on a rounded
 * pane of graphite, the name centred underneath, no box around the pair. On hover
 * the icon floats up and glows in the app's own colour (see .app in globals.css).
 */
function DailyTile({ app, index }: { app: AppEntry; index: number }) {
  return (
    <a
      href={app.href}
      target="_blank"
      rel="noopener noreferrer"
      title={app.description}
      style={{ "--tint": app.tint, "--i": index } as CSSProperties}
      className={`app enter group flex w-full max-w-[8.5rem] flex-col items-center gap-3 rounded-3xl p-1 ${focusRing}`}
    >
      <AmbientTrigger />

      <span className="app-icon relative flex size-[4.75rem] items-center justify-center rounded-[22px] sm:size-24 sm:rounded-[26px]">
        {app.logo ? (
          <img
            src={`/logos/${app.logo}.svg`}
            alt=""
            width={52}
            height={52}
            className="logo-img size-10 object-contain sm:size-[3.25rem]"
          />
        ) : (
          <Dumbbell className="logo-img size-9 sm:size-12" style={{ color: app.tint }} aria-hidden="true" />
        )}
      </span>

      <span className="app-name text-center text-sm font-medium leading-tight tracking-tight sm:text-[15px]">{app.name}</span>
    </a>
  )
}

export function DailyApps() {
  return (
    <section aria-labelledby="daily-heading">
      <h2 id="daily-heading" className="mb-3 text-sm font-medium text-muted-foreground">
        Your apps
      </h2>
      <div className="grid grid-cols-3 justify-items-center gap-x-2 gap-y-7 sm:grid-cols-5 sm:gap-x-4">
        {DAILY.map((app, index) => (
          <DailyTile key={app.name} app={app} index={index} />
        ))}
      </div>
    </section>
  )
}
