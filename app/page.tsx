import { readConfig } from "@/lib/config";
import Dashboard from "@/components/Dashboard";
import FloatingNav from "@/components/FloatingNav";
import CalendarWidget from "@/components/CalendarWidget";
import { StatusProvider } from "@/components/StatusProvider";
import { EditModeProvider } from "@/components/EditMode";
import { fetchCalendar, fetchCalendarRange } from "@/lib/calendar";
import { fetchFeed } from "@/lib/feed";
import { fetchWeather } from "@/lib/weather";
import FeedWidget from "@/components/widgets/FeedWidget";
import { greetingFor, hourIn, shortDate } from "@/lib/datetime";
import { resolveLayoutWidgets } from "@/lib/layout";
import { isAdminSession } from "@/lib/api-auth";
import { navPages } from "@/lib/nav";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const config = await readConfig();
  const { settings, apps, bookmarks } = config;

  // One poller wraps both the status widgets and the per-app dots; only
  // enable it when status checks are on and there are apps to monitor.
  const statusEnabled = settings.statusChecks && apps.length > 0;

  const cal = settings.calendar;
  const calAuth = { username: cal.username, password: cal.password };
  const nowDate = new Date();
  const now = nowDate.getTime();
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
  // guards), so its layout cell isn't left empty when it won't.
  const calendarVisible =
    calEnabled && !(cal.hideWhenEmpty && events.length === 0);

  // The RSS feed widget's items, fetched (and cached) server-side like the
  // calendar's events.
  const feedCfg = settings.feed;
  const feedEnabled = feedCfg.enabled && feedCfg.url.trim() !== "";
  const feed = feedEnabled ? await fetchFeed(feedCfg.url, feedCfg.count) : null;

  // Server-computed seeds (admin default tz/location) so the SSR'd widgets have
  // real content before the client applies the visitor's effective prefs.
  const timeZone = settings.timezone || "UTC";
  const initialDate = shortDate(nowDate, timeZone);
  const initialGreeting = greetingFor(hourIn(nowDate, timeZone));
  const weather = settings.weather;
  const initialWeather = weather.enabled
    ? await fetchWeather(weather.latitude, weather.longitude, weather.units)
    : null;

  // Admin state only unlocks the layout-editor UI (saves go through the gated
  // settings API); ?edit=1 is the deep link from admin Settings → Layout.
  const isAdmin = await isAdminSession();
  const params = await searchParams;
  const initialEditing = isAdmin && params.edit === "1";

  const widgets = resolveLayoutWidgets(
    settings.layout.sections,
    settings.components
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-12 px-6 py-12 sm:px-10 lg:py-16">
      <StatusProvider enabled={statusEnabled}>
        <EditModeProvider isAdmin={isAdmin} initialEditing={initialEditing}>
          <Dashboard
            widgets={widgets}
            scale={settings.layout.scale}
            apps={apps}
            bookmarks={bookmarks}
            search={settings.search}
            categoryOrder={settings.bookmarkCategoryOrder}
            initialDate={initialDate}
            initialGreeting={initialGreeting}
            initialWeather={initialWeather}
            weatherEnabled={weather.enabled}
            showClock={settings.components.clock}
            statusEnabled={statusEnabled}
            notes={settings.notes}
            countdown={settings.countdown}
            feed={
              feedEnabled ? (
                <FeedWidget feed={feed} titleOverride={feedCfg.title} />
              ) : null
            }
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

          {settings.components.settingsButton && (
            <FloatingNav {...navPages(settings)} />
          )}
        </EditModeProvider>
      </StatusProvider>
    </main>
  );
}
