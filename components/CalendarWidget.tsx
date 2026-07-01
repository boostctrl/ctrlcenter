import Link from "next/link";
import AgendaList from "./AgendaList";
import { MiniMonth } from "./CalendarMonth";
import type { CalendarEvent } from "@/lib/calendar";

// Home-page calendar card. Defaults to the upcoming-events agenda; with
// view="month" it shows a compact month grid and the whole card links to
// /calendar. When the calendar is enabled it renders an empty state (so it stays
// discoverable) unless `hideWhenEmpty` is set, in which case an empty feed
// renders nothing at all; a disabled calendar always renders nothing.
export default function CalendarWidget({
  events,
  now,
  enabled,
  view = "agenda",
  hideWhenEmpty = false,
}: {
  events: CalendarEvent[];
  now: number;
  enabled: boolean;
  view?: "agenda" | "month";
  hideWhenEmpty?: boolean;
}) {
  if (!enabled) return null;
  if (hideWhenEmpty && events.length === 0) return null;

  if (view === "month") {
    return (
      <Link
        href="/calendar"
        className="glass-card block p-6 transition-colors hover:bg-fg/[0.03]"
      >
        <MiniMonth
          events={events}
          now={now}
          hint={<span className="text-xs text-fg/45">View calendar</span>}
        />
      </Link>
    );
  }

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
