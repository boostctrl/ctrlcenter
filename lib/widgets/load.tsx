// Server-side: build the home page's widget data (#285). Most of it comes
// straight from the config; the widgets that fetch at request time have a
// loader each, keyed by the widget that owns the data and run concurrently,
// so a slow upstream only costs its own time, not the sum. Each fetch is
// independently time-boxed and degrades to null/[] on failure, so one
// unresponsive service can never hang the render — the page loads and that
// widget simply degrades or fills in client-side.
import type { ReactNode } from "react";
import CalendarWidget from "@/components/CalendarWidget";
import FeedWidget from "@/components/widgets/FeedWidget";
import { fetchCalendar, fetchCalendarRange } from "../calendar-fetch";
import { fetchFeeds } from "../feed";
import { fetchWeather } from "../weather";
import { collectSystemStats } from "../system-stats";
import { greetingFor, hourIn, shortDate } from "../datetime";
import { getCalendarAuth } from "../config";
import { feedUrls, type AppItem, type BookmarkItem, type Settings } from "../schema";
import type { LayoutWidget, LayoutWidgetId } from "../layout";
import type { HomeData } from "./data";

const DAY = 86_400_000;

type LoadContext = {
  settings: Settings;
  apps: AppItem[];
  bookmarks: BookmarkItem[];
  // The resolved arrangement, so a loader can skip work for a hidden widget.
  widgets: LayoutWidget[];
  // The admin previews every widget in the editor, hidden ones included.
  isAdmin: boolean;
  now: Date;
};

type Loader = (ctx: LoadContext) => Promise<Partial<HomeData>>;

const LOADERS: Partial<Record<LayoutWidgetId, Loader>> = {
  // The month view needs every event across the current month grid (a range),
  // the agenda the next N upcoming. A ~40-day window either side of now covers
  // the current month plus its leading/trailing neighbour days in any zone.
  async calendar({ settings, now }) {
    const cal = settings.calendar;
    if (!cal.enabled || cal.url.trim() === "") return {};
    // Calendar credentials are redacted from the public config (stripSecrets),
    // so read them from the server-only accessor — they must never reach a
    // client component. Only when the widget is configured, so an unused
    // calendar costs no extra config read.
    const auth = await getCalendarAuth();
    const t = now.getTime();
    const events =
      cal.homeView === "month"
        ? await fetchCalendarRange(cal.url, t - 40 * DAY, t + 40 * DAY, auth)
        : await fetchCalendar(cal.url, cal.count, auth);
    // Rendered only when the widget will actually show (CalendarWidget's own
    // guards), so its layout cell isn't left empty when it won't.
    if (cal.hideWhenEmpty && events.length === 0) return {};
    return {
      calendar: (
        <CalendarWidget
          events={events}
          now={t}
          enabled
          view={cal.homeView}
          hideWhenEmpty={cal.hideWhenEmpty}
        />
      ),
    };
  },

  // One rendered card per active feed instance (enabled with at least one
  // URL), keyed by instance id; one render can fan out to every active card —
  // bounded by MAX_FEED_CARDS × MAX_FEED_URLS. The label (title, else a
  // generic) is what the editor's frame/tray shows to tell cards apart.
  async feed({ settings }) {
    const cards = settings.feeds.map((config) => {
      const urls = feedUrls(config);
      return { config, urls, active: config.enabled && urls.length > 0 };
    });
    const results = await Promise.all(
      cards.map((c) => (c.active ? fetchFeeds(c.urls, c.config.count) : Promise.resolve(null)))
    );
    const feedNodes: Record<string, ReactNode> = {};
    const feedLabels: Record<string, string> = {};
    cards.forEach((c, i) => {
      feedLabels[c.config.id] = c.config.title.trim() || "RSS feed";
      if (c.active) {
        feedNodes[c.config.id] = (
          <FeedWidget
            feed={results[i]}
            titleOverride={c.config.title}
            showSummaries={c.config.summaries}
          />
        );
      }
    });
    return { feedNodes, feedLabels };
  },

  // Seeds both the Weather widget and the combined header card.
  async weather({ settings }) {
    const w = settings.weather;
    if (!w.enabled) return {};
    return { initialWeather: await fetchWeather(w.latitude, w.longitude, w.units) };
  },

  // Gated on the widget actually being shown (or the admin, who previews every
  // widget in the editor), so a hidden card costs no reads on a guest render.
  async systemStats({ settings, widgets, isAdmin }) {
    const shown = isAdmin || widgets.some((w) => w.id === "systemStats" && !w.hidden);
    if (!shown) return {};
    return {
      systemStats: {
        title: settings.systemStats.title,
        stats: await collectSystemStats(settings.systemStats.disks),
      },
    };
  },
};

export async function loadHomeData(ctx: LoadContext): Promise<HomeData> {
  const { settings, apps, bookmarks, now } = ctx;
  // Server-computed seeds (admin default tz/location) so the SSR'd widgets
  // have real content before the client applies the visitor's prefs.
  const timeZone = settings.timezone || "UTC";
  const base: HomeData = {
    apps,
    bookmarks,
    search: settings.search,
    categoryOrder: settings.bookmarkCategoryOrder,
    groupPrivateApps: settings.groupPrivateApps,
    initialDate: shortDate(now, timeZone),
    initialGreeting: greetingFor(hourIn(now, timeZone)),
    initialWeather: null,
    initialNow: now.toISOString(),
    weatherEnabled: settings.weather.enabled,
    showClock: settings.components.clock,
    // One poller wraps both the status widgets and the per-app dots; only on
    // when status checks are on and there are apps to monitor.
    statusEnabled: settings.statusChecks && apps.length > 0,
    notes: settings.notes,
    countdown: settings.countdown,
    worldClocks: settings.worldClocks,
    systemStats: { title: settings.systemStats.title, stats: null },
    calendar: null,
    feedNodes: {},
    feedLabels: {},
  };
  const parts = await Promise.all(Object.values(LOADERS).map((load) => load(ctx)));
  return Object.assign(base, ...parts);
}
