import { readConfig } from "@/lib/config";
import Header from "@/components/Header";
import Dashboard from "@/components/Dashboard";
import FloatingNav from "@/components/FloatingNav";
import CalendarWidget from "@/components/CalendarWidget";
import { StatusProvider } from "@/components/StatusProvider";
import { fetchCalendar, fetchCalendarRange } from "@/lib/calendar";
import { resolveLayoutSections } from "@/lib/layout";
import { navPages } from "@/lib/nav";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

export default async function HomePage() {
  const config = await readConfig();
  const { settings, apps, bookmarks } = config;

  // One poller wraps both the header status row and the per-app dots; only
  // enable it when status checks are on and there are apps to monitor.
  const statusEnabled = settings.statusChecks && apps.length > 0;

  const cal = settings.calendar;
  const calAuth = { username: cal.username, password: cal.password };
  const now = new Date().getTime();
  // The month widget needs every event across the current month grid (a range),
  // while the agenda widget needs the next N upcoming. A ~40-day window either
  // side of now covers the current month plus its leading/trailing neighbour days
  // in any time zone.
  const calEnabled = cal.enabled && cal.url.trim() !== "";
  const events = calEnabled
    ? cal.homeView === "month"
      ? await fetchCalendarRange(cal.url, now - 40 * DAY, now + 40 * DAY, calAuth)
      : await fetchCalendar(cal.url, cal.count, calAuth)
    : [];
  // Whether the widget will actually render (matches CalendarWidget's own
  // guards), so the Dashboard layout cell isn't left empty when it won't.
  const calendarVisible =
    calEnabled && !(cal.hideWhenEmpty && events.length === 0);

  const components = settings.components;
  const layout = resolveLayoutSections(settings.layout.sections);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-12 px-6 py-12 sm:px-10 lg:py-16">
      <StatusProvider enabled={statusEnabled}>
        <Header settings={settings} apps={apps} statusEnabled={statusEnabled} />

        <Dashboard
          apps={apps}
          bookmarks={bookmarks}
          search={settings.search}
          categoryOrder={settings.bookmarkCategoryOrder}
          showSearch={components.search}
          showApps={components.apps}
          showBookmarks={components.bookmarks}
          showFavorites={components.favorites}
          layout={layout}
          calendar={
            calendarVisible ? (
              <CalendarWidget
                events={events}
                now={now}
                enabled
                view={cal.homeView}
                hideWhenEmpty={cal.hideWhenEmpty}
              />
            ) : null
          }
        />
      </StatusProvider>

      {components.settingsButton && <FloatingNav {...navPages(settings)} />}
    </main>
  );
}
