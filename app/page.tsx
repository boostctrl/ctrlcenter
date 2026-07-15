import Dashboard from "@/components/Dashboard";
import FloatingNav from "@/components/FloatingNav";
import CalendarWidget from "@/components/CalendarWidget";
import { StatusProvider } from "@/components/StatusProvider";
import { EditModeProvider } from "@/components/EditMode";
import { fetchCalendar, fetchCalendarRange } from "@/lib/calendar";
import { fetchFeeds } from "@/lib/feed";
import { fetchWeather } from "@/lib/weather";
import FeedWidget from "@/components/widgets/FeedWidget";
import { greetingFor, hourIn, shortDate } from "@/lib/datetime";
import { resolveLayoutWidgets, smallScreenTopGap } from "@/lib/layout";
import { feedUrls } from "@/lib/schema";
import { getCalendarAuth } from "@/lib/config";
import { readPublicConfig } from "@/lib/api-auth";
import { navPages } from "@/lib/nav";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // readPublicConfig already dropped private apps/bookmarks for guests, and
  // everything derived from the lists (search matches, per-app bangs, category
  // grouping) follows from the filtered arrays for free. `isAdmin` also
  // unlocks the layout-editor UI (saves go through the gated settings API);
  // ?edit=1 is the deep link from admin Settings → Layout.
  const { config, isAdmin } = await readPublicConfig();
  const { settings, apps, bookmarks } = config;

  // One poller wraps both the status widgets and the per-app dots; only
  // enable it when status checks are on and there are apps to monitor.
  const statusEnabled = settings.statusChecks && apps.length > 0;

  const cal = settings.calendar;
  const nowDate = new Date();
  const now = nowDate.getTime();
  // The month widget needs every event across the current month grid (a range),
  // while the agenda widget needs the next N upcoming. A ~40-day window either
  // side of now covers the current month plus its leading/trailing neighbour days
  // in any time zone.
  const calEnabled = cal.enabled && cal.url.trim() !== "";
  // Calendar credentials are redacted from the public config (stripSecrets), so
  // read them from the server-only accessor for the server-side fetch below —
  // they must never reach a client component. Only when the widget is actually
  // configured, so an unused calendar costs no extra config read.
  const calAuth = calEnabled
    ? await getCalendarAuth()
    : { username: "", password: "" };
  const feedCfg = settings.feed;
  const feedList = feedUrls(feedCfg);
  const feedEnabled = feedCfg.enabled && feedList.length > 0;
  const weather = settings.weather;

  // Fetch the three third-party widgets (calendar, RSS feed, weather)
  // concurrently rather than in series, so a slow upstream only costs its own
  // time, not the sum. Each fetch is independently time-boxed and returns
  // null/[] on failure, so one unresponsive service can never hang the render —
  // the page loads and that widget simply degrades or fills in client-side.
  const [events, feed, initialWeather] = await Promise.all([
    calEnabled
      ? cal.homeView === "month"
        ? fetchCalendarRange(cal.url, now - 40 * DAY, now + 40 * DAY, calAuth)
        : fetchCalendar(cal.url, cal.count, calAuth)
      : Promise.resolve([]),
    feedEnabled ? fetchFeeds(feedList, feedCfg.count) : Promise.resolve(null),
    weather.enabled
      ? fetchWeather(weather.latitude, weather.longitude, weather.units)
      : Promise.resolve(null),
  ]);

  // Whether the calendar widget will actually render (matches CalendarWidget's
  // own guards), so its layout cell isn't left empty when it won't.
  const calendarVisible =
    calEnabled && !(cal.hideWhenEmpty && events.length === 0);

  // Server-computed seeds (admin default tz/location) so the SSR'd widgets have
  // real content before the client applies the visitor's effective prefs.
  const timeZone = settings.timezone || "UTC";
  const initialDate = shortDate(nowDate, timeZone);
  const initialGreeting = greetingFor(hourIn(nowDate, timeZone));

  const params = await searchParams;
  const initialEditing = isAdmin && params.edit === "1";

  const widgets = resolveLayoutWidgets(
    settings.layout.sections,
    settings.components
  );

  // The gap above the first row of widgets, tunable from the layout editor
  // (Dashboard keeps these variables live while editing). The stored value
  // applies on large screens; smaller ones cap it at the stock 48px.
  const topGap = settings.layout.topGap;

  return (
    <main
      style={
        {
          "--top-gap": `${smallScreenTopGap(topGap)}px`,
          "--top-gap-lg": `${topGap}px`,
        } as React.CSSProperties
      }
      className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-12 px-6 pt-[var(--top-gap)] pb-12 sm:px-10 lg:pt-[var(--top-gap-lg)] lg:pb-16"
    >
      <StatusProvider enabled={statusEnabled}>
        <EditModeProvider isAdmin={isAdmin} initialEditing={initialEditing}>
          <Dashboard
            widgets={widgets}
            scale={settings.layout.scale}
            gap={settings.layout.gap}
            topGap={topGap}
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
            worldClocks={settings.worldClocks}
            initialNow={nowDate.toISOString()}
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
