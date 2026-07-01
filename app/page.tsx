import { readConfig } from "@/lib/config";
import Header from "@/components/Header";
import Dashboard from "@/components/Dashboard";
import FloatingSettings from "@/components/FloatingSettings";
import CalendarWidget from "@/components/CalendarWidget";
import { StatusProvider } from "@/components/StatusProvider";
import { fetchCalendar } from "@/lib/calendar";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const config = await readConfig();
  const { settings, apps, bookmarks } = config;

  // One poller wraps both the header status row and the per-app dots; only
  // enable it when status checks are on and there are apps to monitor.
  const statusEnabled = settings.statusChecks && apps.length > 0;

  const cal = settings.calendar;
  const events =
    cal.enabled && cal.url
      ? await fetchCalendar(cal.url, cal.count, {
          username: cal.username,
          password: cal.password,
        })
      : [];

  const components = settings.components;

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
          calendar={
            <CalendarWidget
              events={events}
              now={new Date().getTime()}
              enabled={cal.enabled && cal.url.trim() !== ""}
              hideWhenEmpty={cal.hideWhenEmpty}
            />
          }
        />
      </StatusProvider>

      {components.settingsButton && <FloatingSettings />}
    </main>
  );
}
