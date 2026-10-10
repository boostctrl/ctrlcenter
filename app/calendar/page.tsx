import type { Metadata } from "next";
import Link from "next/link";
import { viewerIsAdmin } from "@/lib/api-auth";
import { getSiteConfig } from "@/lib/config";
import { asCalendar, fetchCalendar, fetchCalendarRange } from "@/lib/calendar-fetch";
import CalendarView from "@/components/CalendarView";
import PageNav from "@/components/PageNav";
import FloatingNav from "@/components/FloatingNav";
import { activeCalendars, navPages } from "@/lib/nav";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;
// The month view can page one month back and three forward; fetch a range that
// safely covers those months (plus each grid's neighbouring days) so navigation
// never lands on stale-empty data. minOffset/maxOffset below match this window.
const RANGE_BACK = 70 * DAY;
const RANGE_FWD = 130 * DAY;

// How many upcoming events the agenda view lists.
const AGENDA_COUNT = 20;

// The calendar's own page, mirroring /weather and /status. Defaults to a month
// grid (the home widget defaults to the agenda) with an Agenda toggle. Every
// calendar widget with a feed contributes (#297), merged by start time.
export default async function CalendarPage() {
  // The full config: each calendar's credentials go into its fetch.
  const [site, isAdmin] = await Promise.all([getSiteConfig(), viewerIsAdmin()]);
  const { settings } = site;
  const calendars = activeCalendars(site, isAdmin);
  const enabled = calendars.length > 0;
  const now = new Date().getTime();
  const perCalendar = await Promise.all(
    calendars.map((c) =>
      asCalendar(c.id, () => {
        const auth = { username: c.username, password: c.password };
        return Promise.all([
          fetchCalendarRange(c.url, now - RANGE_BACK, now + RANGE_FWD, auth),
          fetchCalendar(c.url, AGENDA_COUNT, auth),
        ]);
      })
    )
  );
  const byStart = (a: { start: number }, b: { start: number }) => a.start - b.start;
  const monthEvents = perCalendar.flatMap(([month]) => month).sort(byStart);
  const agendaEvents = perCalendar
    .flatMap(([, agenda]) => agenda)
    .sort(byStart)
    .slice(0, AGENDA_COUNT);

  return (
    <>
      <main id="main-content" className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-8 px-6 pt-12 pb-24 sm:px-10 lg:pt-16">
        <div>
          <PageNav current="calendar" {...navPages(site, isAdmin)} />
          <h1 className="mt-3 text-3xl font-bold">Calendar</h1>
        </div>

        {!enabled ? (
          <p className="text-ink-50">
            The calendar is turned off.{" "}
            <Link href="/admin" className="underline hover:text-ink-80">
              Enable it in admin settings
            </Link>
            .
          </p>
        ) : (
          <CalendarView
            monthEvents={monthEvents}
            agendaEvents={agendaEvents}
            now={now}
            minOffset={-1}
            maxOffset={3}
          />
        )}
      </main>
      {settings.settingsButton && <FloatingNav {...navPages(site, isAdmin)} />}
    </>
  );
}
