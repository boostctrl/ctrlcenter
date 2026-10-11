import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { SIZED_WIDGET_TYPES, type LayoutWidget } from "@/lib/layout";
import { groupBookmarks } from "@/lib/groups";
import { newInstance } from "@/lib/schema/instances";
import type { AppItem, BookmarkItem, Group } from "@/lib/schema";
import type { HomeData } from "@/lib/widgets/data";
import CalendarWidget from "../CalendarWidget";
import FeedWidget from "./FeedWidget";

// The visitor prefs the cards read, without a PrefsProvider around them.
vi.mock("../PrefsProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../PrefsProvider")>()),
  useFavorites: () => ({ favorites: [] as string[], toggleFavorite: () => {} }),
  useLookPrefs: () => ({ surfaceIsLight: false }),
  useLocalePrefs: () => ({ timezone: "UTC", name: "" }),
}));
// jsdom has no ResizeObserver (TilesBox measures its overflow with one).
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  }
);

const { WIDGET_RENDERERS } = await import("./registry");

const app: AppItem = {
  id: "plex",
  name: "Plex",
  subtitle: "Media",
  url: "https://plex.example.com",
  icon: "",
  expectStatus: "",
  checkType: "http",
  keyword: "",
  private: false,
  monitor: true,
  jsonQuery: "",
  pushToken: "",
  group: "",
  tags: [],
};
const bookmark: BookmarkItem = {
  id: "amazon",
  group: "shopping",
  name: "Amazon",
  url: "https://amazon.com",
  icon: "",
  private: false,
};
const groups: Group[] = [{ id: "shopping", name: "Shopping" }];

const data = {
  apps: [app],
  bookmarks: [bookmark],
  groups,
  instances: {
    notes: { ...newInstance("notes", "notes"), content: "Renew the certificates." },
    countdown: { ...newInstance("countdown", "countdown"), items: [{ label: "Launch", date: "2099-01-01" }] },
    worldClocks: { ...newInstance("worldClocks", "worldClocks"), items: [{ label: "UTC", timeZone: "UTC" }] },
    systemStats: newInstance("systemStats", "systemStats"),
    favorites: newInstance("favorites", "favorites"),
    apps: newInstance("apps", "apps"),
    bookmarks: newInstance("bookmarks", "bookmarks"),
  },
  labels: {},
  nodes: {
    calendar: <CalendarWidget events={[]} now={Date.UTC(2026, 9, 11)} enabled />,
    feed: <FeedWidget feed={{ title: "News", items: [] }} titleOverride="" />,
  },
  systemStats: {
    systemStats: { source: "container", cpu: { percent: 12, cores: 4 }, memory: null, disks: [] },
  },
  integrationTiles: {},
  apiViews: {},
  initialNow: "2026-10-11T06:00:00.000Z",
} as unknown as HomeData;

const ctx = {
  data,
  editing: false,
  q: "",
  search: { query: "", setQuery: () => {}, inputRef: () => {}, onKeyDown: () => {} },
  hasAnyContent: true,
  hasVisibleContent: true,
  favoriteApps: [app],
  filteredApps: [app],
  filteredGroups: groupBookmarks([bookmark], groups),
  topMatchId: null,
};

// The sized widgets' contract with .widget-sized (globals.css, #353): at an
// explicit height the cell stops clipping and what scrolls is the widget's
// own last box — so each renders a <section> whose last child is the card
// (.glass-card) or the tile grid's scroll box (.widget-tiles). Anything else
// would spill past the cell.
describe("sized widget renderers", () => {
  it.each(SIZED_WIDGET_TYPES)("%s renders a section ending in its card or tile box", (type) => {
    const widget: LayoutWidget = { id: type, type, span: 24, hidden: false };
    const node = WIDGET_RENDERERS[type](widget, ctx);
    expect(node).not.toBeNull();
    const { container } = render(<>{node}</>);
    expect(container.childElementCount).toBe(1);
    const root = container.firstElementChild!;
    expect(root.tagName).toBe("SECTION");
    const last = root.lastElementChild!;
    expect(
      last.classList.contains("glass-card") || last.classList.contains("widget-tiles"),
      `last child of ${type}: ${last.className}`
    ).toBe(true);
  });
});
