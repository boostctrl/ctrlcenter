import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/config";
import { fetchCalendar } from "@/lib/calendar";
import AgendaList from "@/components/AgendaList";
import BackHome from "@/components/BackHome";
import FloatingSettings from "@/components/FloatingSettings";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

// The full agenda — the calendar's own page, mirroring /weather and /status, so
// the feature is discoverable beyond the home card. Shows more events than the
// home card and gives a clear off/empty state.
export default async function CalendarPage() {
  const { calendar, components } = await getSettings();
  const enabled = calendar.enabled && calendar.url.trim() !== "";
  const events = enabled
    ? await fetchCalendar(calendar.url, 20, {
        username: calendar.username,
        password: calendar.password,
      })
    : [];

  return (
    <>
      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-12 sm:px-10 lg:py-16">
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
        ) : events.length > 0 ? (
          <section className="glass-card max-w-2xl p-6">
            <AgendaList events={events} now={new Date().getTime()} />
          </section>
        ) : (
          <p className="text-fg/50">No upcoming events.</p>
        )}
      </main>
      {components.settingsButton && <FloatingSettings />}
    </>
  );
}
