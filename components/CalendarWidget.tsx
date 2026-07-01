import Link from "next/link";
import AgendaList from "./AgendaList";
import { MiniMonth } from "./CalendarMonth";
import SectionTitle from "./SectionTitle";
import type { CalendarEvent } from "@/lib/calendar";

// Home-page calendar section. Uses the shared SectionTitle so its heading reads
// the same as the other dashboard sections (important when half-width). Defaults
// to the upcoming-events agenda; with view="month" it shows a compact month grid
// whose card links to /calendar. When the calendar is enabled it renders an empty
// state (so it stays discoverable) unless `hideWhenEmpty` is set, in which case an
// empty feed renders nothing; a disabled calendar always renders nothing.
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
      <section>
        <SectionTitle>Calendar</SectionTitle>
        <Link
          href="/calendar"
          className="glass-card block p-6 transition-colors hover:bg-fg/[0.03]"
        >
          <MiniMonth events={events} now={now} />
        </Link>
      </section>
    );
  }

  return (
    <section>
      <SectionTitle
        action={
          <Link
            href="/calendar"
            className="text-xs text-fg/45 transition-colors hover:text-fg/80"
          >
            View calendar
          </Link>
        }
      >
        Upcoming
      </SectionTitle>
      <div className="glass-card p-6">
        {events.length > 0 ? (
          <AgendaList events={events} now={now} />
        ) : (
          <p className="text-sm text-fg/45">No upcoming events.</p>
        )}
      </div>
    </section>
  );
}
