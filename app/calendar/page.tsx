import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/config";
import { fetchCalendar, fetchCalendarRange } from "@/lib/calendar";
import CalendarView from "@/components/CalendarView";
import BackHome from "@/components/BackHome";
import FloatingNav from "@/components/FloatingNav";
import { navPages } from "@/lib/nav";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;
// The month view can page one month back and three forward; fetch a range that
// safely covers those months (plus each grid's neighbouring days) so navigation
// never lands on stale-empty data. minOffset/maxOffset below match this window.
const RANGE_BACK = 70 * DAY;
const RANGE_FWD = 130 * DAY;

// The calendar's own page, mirroring /weather and /status. Defaults to a month
// grid (the home widget defaults to the agenda) with an Agenda toggle.
export default async function CalendarPage() {
  const settings = await getSettings();
  const { calendar, components } = settings;
  const enabled = calendar.enabled && calendar.url.trim() !== "";
  const now = new Date().getTime();
  const auth = { username: calendar.username, password: calendar.password };
  const [monthEvents, agendaEvents] = enabled
    ? await Promise.all([
        fetchCalendarRange(calendar.url, now - RANGE_BACK, now + RANGE_FWD, auth),
        fetchCalendar(calendar.url, 20, auth),
      ])
    : [[], []];

  return (
    <>
      <main className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-8 px-6 py-12 sm:px-10 lg:py-16">
        <div>
          <BackHome />
          <h1 className="mt-3 text-3xl font-bold">Calendar</h1>
        </div>

        {!enabled ? (
          <p className="text-fg/50">
            The calendar is turned off.{" "}
            <Link href="/admin" className="underline hover:text-fg/80">
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
      {components.settingsButton && <FloatingNav {...navPages(settings)} />}
    </>
  );
}
