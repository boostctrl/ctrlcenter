import Link from "next/link";
import AgendaList from "./AgendaList";
import type { CalendarEvent } from "@/lib/calendar";

// Home-page agenda card: the next few events, with a link to the full /calendar
// page. When the calendar is enabled it renders an empty state (so it stays
// discoverable) unless `hideWhenEmpty` is set, in which case an empty agenda
// renders nothing at all; a disabled calendar always renders nothing.
export default function CalendarWidget({
  events,
  now,
  enabled,
  hideWhenEmpty = false,
}: {
  events: CalendarEvent[];
  now: number;
  enabled: boolean;
  hideWhenEmpty?: boolean;
}) {
  if (!enabled) return null;
  if (hideWhenEmpty && events.length === 0) return null;
  return (
    <section className="glass-card p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold tracking-[0.2em] text-fg/60 uppercase">
          Upcoming
        </h2>
        <Link
          href="/calendar"
          className="text-xs text-fg/45 transition-colors hover:text-fg/80"
        >
          View calendar
        </Link>
      </div>
      {events.length > 0 ? (
        <AgendaList events={events} now={now} />
      ) : (
        <p className="text-sm text-fg/45">No upcoming events.</p>
      )}
    </section>
  );
}
