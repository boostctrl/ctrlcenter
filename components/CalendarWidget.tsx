import type { CalendarEvent } from "@/lib/calendar";

// `YYYY-MM-DD` for an instant in a zone, for day-equality checks.
function dayKey(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function dayLabel(ms: number, tz: string, now: number): string {
  const k = dayKey(ms, tz);
  if (k === dayKey(now, tz)) return "Today";
  if (k === dayKey(now + 86_400_000, tz)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

function timeLabel(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

// Agenda card: the next few events from the configured iCal feed. Times render
// in the site's default time zone (server-rendered). Renders nothing when empty
// so it never shows a stale/blank card. `now` is passed in (computed at the
// request boundary) so the render stays pure.
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
        {events.map((e, i) => (
          <li key={i} className="flex items-baseline gap-4">
            <div className="w-24 shrink-0">
              <span className="block text-sm font-medium text-fg/80">
                {dayLabel(e.start, timeZone, now)}
              </span>
              <span className="text-xs text-fg/45">
                {e.allDay ? "All day" : timeLabel(e.start, timeZone)}
              </span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-fg/90">{e.summary}</p>
              {e.location && (
                <p className="truncate text-xs text-fg/45">{e.location}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
