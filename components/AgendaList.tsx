"use client";

import { useVisitorPrefs } from "./PrefsProvider";
import { eventWhen, type CalendarEvent } from "@/lib/calendar";

// The list of agenda rows, shared by the home "Upcoming" card and the /calendar
// page. Times render in the visitor's effective time zone (it starts as the admin
// default so hydration matches SSR, then switches on mount — like TimeWeather).
// `now` is passed in (computed at the request boundary) so the first render is pure.
export default function AgendaList({
  events,
  now,
}: {
  events: CalendarEvent[];
  now: number;
}) {
  const { timezone } = useVisitorPrefs();
  return (
    <ul className="flex flex-col gap-3">
      {events.map((e, i) => {
        const { day, time } = eventWhen(e, timezone, now);
        return (
          <li key={i} className="flex items-baseline gap-4">
            <div className="w-24 shrink-0">
              <span
                className="block text-sm font-medium text-fg/80"
                suppressHydrationWarning
              >
                {day}
              </span>
              <span className="text-xs text-fg/45" suppressHydrationWarning>
                {time}
              </span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-fg/90">{e.summary}</p>
              {e.location && (
                <p className="truncate text-xs text-fg/45">{e.location}</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
