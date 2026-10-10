// Server-side: build the home page's widget data (#285). Most of it comes
// straight from the config; the widgets that fetch at request time have a
// loader each, keyed by the widget that owns the data and run concurrently,
// so a slow upstream only costs its own time, not the sum. Each fetch is
// independently time-boxed and degrades to null/[] on failure, so one
// unresponsive service can never hang the render — the page loads and that
// widget simply degrades or fills in client-side. Widgets are instances since
// 3.0 (#297): a loader works through every instance of its type.
import type { ReactNode } from "react";
import CalendarWidget from "@/components/CalendarWidget";
import FeedWidget from "@/components/widgets/FeedWidget";
import { asCalendar, fetchCalendar, fetchCalendarRange } from "../calendar-fetch";
import { fetchFeeds } from "../feed";
import { fetchWeather } from "../weather";
import { collectSystemStats, type SystemStats } from "../system-stats";
import { greetingFor, hourIn, shortDate } from "../datetime";
import { getCalendarAuth, getSiteConfig } from "../config";
import { integrationTiles } from "./integration-tiles";
import { getApiView, publicApiInstance, type ApiResult } from "../api-widget";
import {
  feedUrls,
  monitoredApps,
  type AppItem,
  type BookmarkItem,
  type InstanceOf,
  type Settings,
  type Group,
  type WidgetInstance,
} from "../schema";
import type { LayoutWidget } from "../layout";
import type { HomeData } from "./data";
import { instanceLabels } from "./labels";

const DAY = 86_400_000;

type LoadContext = {
  settings: Settings;
  // Every widget instance (public-safe: secrets redacted).
  instances: WidgetInstance[];
  apps: AppItem[];
  bookmarks: BookmarkItem[];
  // The groups apps and bookmarks belong to (#299).
  groups: Group[];
  // The resolved arrangement, so a loader can skip work for a hidden widget.
  widgets: LayoutWidget[];
  // The admin previews every widget in the editor, hidden ones included.
  isAdmin: boolean;
  now: Date;
};

type Loader = (ctx: LoadContext) => Promise<Partial<HomeData>>;

// The instances of `type` worth loading: shown on the board, or (for the admin
// previewing the editor) placed at all.
function shownOf<T extends WidgetInstance["type"]>(
  ctx: LoadContext,
  type: T
): InstanceOf<T>[] {
  const visible = new Set(
    ctx.widgets.filter((w) => w.type === type && (ctx.isAdmin || !w.hidden)).map((w) => w.id)
  );
  return ctx.instances.filter((i): i is InstanceOf<T> => i.type === type && visible.has(i.id));
}

const LOADERS: Loader[] = [
  // The month view needs every event across the current month grid (a range),
  // the agenda the next N upcoming. A ~40-day window either side of now covers
  // the current month plus its leading/trailing neighbour days in any zone.
  // One fetch per calendar widget; the credentials come from the server-only
  // accessor, since the public config has them redacted.
  async (ctx) => {
    const t = ctx.now.getTime();
    const nodes: Record<string, ReactNode> = {};
    await Promise.all(
      shownOf(ctx, "calendar")
        .filter((cal) => cal.url.trim() !== "")
        .map(async (cal) => {
          const auth = await getCalendarAuth(cal.id);
          const events = await asCalendar(cal.id, () =>
            cal.homeView === "month"
              ? fetchCalendarRange(cal.url, t - 40 * DAY, t + 40 * DAY, auth)
              : fetchCalendar(cal.url, cal.count, auth)
          );
          // Rendered only when the widget will actually show (CalendarWidget's
          // own guards), so its layout cell isn't left empty when it won't.
          if (cal.hideWhenEmpty && events.length === 0) return;
          nodes[cal.id] = (
            <CalendarWidget
              events={events}
              now={t}
              enabled
              view={cal.homeView}
              hideWhenEmpty={cal.hideWhenEmpty}
            />
          );
        })
    );
    return { nodes };
  },

  // One rendered card per active feed widget (enabled with at least one URL);
  // one render can fan out to every active card — bounded by MAX_FEED_CARDS ×
  // MAX_FEED_URLS.
  async (ctx) => {
    const nodes: Record<string, ReactNode> = {};
    await Promise.all(
      shownOf(ctx, "feed").map(async (feed) => {
        const urls = feedUrls(feed);
        if (urls.length === 0) return;
        nodes[feed.id] = (
          <FeedWidget
            feed={await fetchFeeds(urls, feed.count)}
            titleOverride={feed.title}
            showSummaries={feed.summaries}
          />
        );
      })
    );
    return { nodes };
  },

  // Seeds both the Weather widget and the combined header card.
  async ({ settings }) => {
    const w = settings.weather;
    if (!w.enabled) return {};
    return { initialWeather: await fetchWeather(w.latitude, w.longitude, w.units) };
  },

  // Gated on the widget actually being shown (or the admin, who previews every
  // widget in the editor), so a hidden card costs no reads on a guest render.
  async (ctx) => {
    const systemStats: Record<string, SystemStats | null> = {};
    await Promise.all(
      shownOf(ctx, "systemStats").map(async (w) => {
        systemStats[w.id] = await collectSystemStats(w.disks);
      })
    );
    return { systemStats };
  },

  // API widgets (#302): admin-only ones only for the admin, and a visitor
  // never sees why one failed (the message could name a host).
  async (ctx) => {
    const widgets = shownOf(ctx, "api").filter((w) => ctx.isAdmin || w.visibility === "public");
    if (widgets.length === 0) return {};
    // The page's instances have their header values blanked (secret); the
    // fetch needs the stored ones.
    const stored = new Map((await getSiteConfig()).widgets.map((w) => [w.id, w]));
    const apiViews: Record<string, ApiResult> = {};
    await Promise.all(
      widgets.map(async (w) => {
        const full = stored.get(w.id);
        const result = await getApiView(full?.type === "api" ? full : w);
        apiViews[w.id] = ctx.isAdmin ? result : { view: result.view, error: result.view ? null : "Unavailable" };
      })
    );
    return { apiViews };
  },

  // Integration tiles (#301): admin-only ones only for the admin. The
  // integrations' credentials come from the server-side config; the public
  // config the page renders from carries none.
  async (ctx) => {
    const widgets = shownOf(ctx, "integration");
    if (widgets.length === 0) return {};
    const { integrations } = await getSiteConfig();
    return {
      integrationTiles: await integrationTiles(widgets, integrations, {
        isAdmin: ctx.isAdmin,
        now: ctx.now.getTime(),
      }),
    };
  },
];

export async function loadHomeData(ctx: LoadContext): Promise<HomeData> {
  const { settings, apps, bookmarks, instances, now } = ctx;
  // Server-computed seeds (admin default tz/location) so the SSR'd widgets
  // have real content before the client applies the visitor's prefs.
  const timeZone = settings.timezone || "UTC";
  const base: HomeData = {
    apps,
    bookmarks,
    search: settings.search,
    groups: ctx.groups,
    initialDate: shortDate(now, timeZone),
    initialGreeting: greetingFor(hourIn(now, timeZone)),
    initialWeather: null,
    initialNow: now.toISOString(),
    weatherEnabled: settings.weather.enabled,
    // One poller wraps both the status widgets and the per-app dots; only on
    // when status checks are on and there are apps to monitor.
    statusEnabled: settings.statusChecks && monitoredApps(apps).length > 0,
    // A visitor's page never carries an API widget's request (#302).
    instances: Object.fromEntries(
      instances.map((i) => [i.id, i.type === "api" && !ctx.isAdmin ? publicApiInstance(i) : i])
    ),
    labels: instanceLabels(instances),
    nodes: {},
    systemStats: {},
    integrationTiles: {},
    apiViews: {},
  };
  const parts = await Promise.all(LOADERS.map((load) => load(ctx)));
  // Merge, combining the per-instance maps rather than letting one loader's
  // map replace another's.
  for (const part of parts) {
    const { nodes, systemStats, ...rest } = part;
    Object.assign(base, rest);
    if (nodes) Object.assign(base.nodes, nodes);
    if (systemStats) Object.assign(base.systemStats, systemStats);
  }
  // An integration tile goes by its integration's name in the editor.
  for (const [id, tile] of Object.entries(base.integrationTiles)) base.labels[id] = tile.label;
  return base;
}
