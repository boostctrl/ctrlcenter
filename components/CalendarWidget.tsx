import { eventWhen, type CalendarEvent } from "@/lib/calendar";

// Agenda card: the next few events from the configured iCal feed. Times render
// in the site's default time zone (server-rendered); all-day events show their
// literal calendar date. Renders nothing when empty so it never shows a
// stale/blank card. `now` is passed in (computed at the request boundary) so the
// render stays pure.
export default function CalendarWidget({
  events,
  timeZone,
  now,
}: {
  events: CalendarEvent[];
  timeZone: string;
  now: number;
}) {
  if (events.length === 0) return null;
  return (
    <section className="glass-card p-6">
      <h2 className="mb-4 text-sm font-semibold tracking-[0.2em] text-fg/60 uppercase">
        Upcoming
      </h2>
      <ul className="flex flex-col gap-3">
        {events.map((e, i) => {
          const { day, time } = eventWhen(e, timeZone, now);
          return (
            <li key={i} className="flex items-baseline gap-4">
              <div className="w-24 shrink-0">
                <span className="block text-sm font-medium text-fg/80">{day}</span>
                <span className="text-xs text-fg/45">{time}</span>
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
    </section>
  );
}
