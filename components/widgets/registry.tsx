"use client";

// How each widget renders on the home page (#285): one renderer per widget type,
// beside the metadata in lib/widgets/defs.ts. A renderer returns the widget's
// node, or null when it has nothing to show right now (feature off, empty, or
// hidden during an active search) — Dashboard then leaves it out of the grid
// and, in the editor, shows its empty reason in the tray. Typed as a Record
// over every widget type, so a type without a renderer fails to compile. A
// renderer reads its own instance's content (#297) through `instanceOf`.
//
// The edit-mode contract: hidden widgets are skipped by Dashboard's render
// loop in view mode, so a renderer only decides content-existence; in edit
// mode search filtering and the q-gates are suspended so every widget
// previews its real content.
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import AppCard from "../AppCard";
import BookmarkGroup from "../BookmarkGroup";
import Greeting from "../Greeting";
import SectionTitle from "../SectionTitle";
import HeaderCardWidget from "./HeaderCardWidget";
import ClockWidget from "./ClockWidget";
import WeatherWidget from "./WeatherWidget";
import StatusWidget from "./StatusWidget";
import NotesWidget from "./NotesWidget";
import CountdownWidget, { isValidCountdownDate } from "./CountdownWidget";
import SystemStatsWidget from "./SystemStatsWidget";
import WorldClocksWidget from "./WorldClocksWidget";
import { isValidTimeZone } from "@/lib/datetime";
import { appMatches, groupBookmarks, type BookmarkGroupView } from "@/lib/groups";
import type { LayoutWidget, WidgetType } from "@/lib/layout";
import type { AppItem, InstanceOf } from "@/lib/schema";
import type { HomeData } from "@/lib/widgets/data";
import Complication from "@/components/monitor/Complication";
import ApiWidget from "./ApiWidget";

// What a renderer can read: the server-built data, plus Dashboard's live
// state (edit mode, the search box and what it currently matches).
export type WidgetRenderContext = {
  data: HomeData;
  editing: boolean;
  // The active search, trimmed and lowercased; "" when not searching.
  q: string;
  search: {
    query: string;
    setQuery: (query: string) => void;
    inputRef: (el: HTMLInputElement | null) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  };
  // Anything configured at all vs. anything the admin left visible to search.
  hasAnyContent: boolean;
  hasVisibleContent: boolean;
  favoriteApps: AppItem[];
  filteredApps: AppItem[];
  filteredGroups: BookmarkGroupView[];
  // What Enter opens while searching, highlighted (#274).
  topMatchId: string | null;
};

type Renderer = (widget: LayoutWidget, ctx: WidgetRenderContext) => ReactNode;

// The instance a placed widget renders, typed by its type; undefined when the
// data has no such instance (it was removed since the page loaded).
function instanceOf<T extends WidgetType>(
  type: T,
  widget: LayoutWidget,
  data: HomeData
): InstanceOf<T> | undefined {
  const i = data.instances[widget.id];
  return i?.type === type ? (i as InstanceOf<T>) : undefined;
}

// Apply the per-widget label toggle to a widget passed in as a pre-rendered
// node (the calendar and feed are built server-side). Cloning lets the toggle
// preview live in the editor without re-fetching their server data.
function withTitle(node: ReactNode, hideLabel?: boolean): ReactNode {
  return isValidElement(node)
    ? cloneElement(node as ReactElement<{ showTitle?: boolean }>, {
        showTitle: !hideLabel,
      })
    : node;
}

// How the inner card/bookmark grids reflow. An explicit `cards` override wins;
// otherwise the count derives from the widget's span (a wide widget, ≥18 of 24
// columns, fits three cards across; a mid one ≥10 two; narrower stacks — the
// same output the old bucket thresholds produced). The count is a cap: the
// steps are container queries against the widget's own width (the section
// around each grid is the @container), not viewport media queries — tile width
// is a function of the card, and span, the page max-width, and the UI scale
// all move it independently of the viewport (#145).
//
// Each rung's threshold is set so the tile stays at least ~280px wide at the
// moment a column is added — the width where a real multi-word name (e.g.
// "Network Attached Storage") still wraps to AppCard's two lines instead of
// ellipsizing. The 1.9.5 rungs (@md/@3xl/@5xl) let tiles bottom out near 245px,
// which truncated names before the grid ever dropped a column; the fix is to
// step DOWN sooner, so a narrowing card sheds a column rather than squeezing
// its tiles. `cards` therefore means "up to N across" — the dense end only
// appears once the card is genuinely wide enough for it. Rem-based thresholds
// track the UI scale, so a scaled-up dashboard collapses proportionally sooner.
// Complete, static class strings so Tailwind's extractor keeps every variant.
const CARD_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 @xl:grid-cols-2",
  3: "grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-3",
  4: "grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4",
};
export const cardsFor = (widget: LayoutWidget): number =>
  widget.cards ?? (widget.span >= 18 ? 3 : widget.span >= 10 ? 2 : 1);
const cardGridClass = (widget: LayoutWidget, gap: string): string =>
  `grid ${gap} ${CARD_COLS[cardsFor(widget)] ?? CARD_COLS[1]}`;

export const WIDGET_RENDERERS: Record<WidgetType, Renderer> = {
  greeting: (_, { data }) => <Greeting initialGreeting={data.initialGreeting} />,

  headerCard: (widget, { data }) => {
    const showClock = instanceOf("headerCard", widget, data)?.showClock ?? true;
    return showClock || data.weatherEnabled || data.statusEnabled ? (
      <HeaderCardWidget
        initialDate={data.initialDate}
        initialWeather={data.initialWeather}
        weatherEnabled={data.weatherEnabled}
        showClock={showClock}
        statusEnabled={data.statusEnabled}
        apps={data.apps}
      />
    ) : null;
  },

  clock: (_, { data }) => <ClockWidget initialDate={data.initialDate} showClock />,

  weather: (_, { data }) =>
    data.weatherEnabled ? (
      <WeatherWidget initialWeather={data.initialWeather} weatherEnabled={data.weatherEnabled} />
    ) : null,

  status: (_, { data }) =>
    data.statusEnabled ? (
      <StatusWidget statusEnabled={data.statusEnabled} apps={data.apps} />
    ) : null,

  search: (_, { editing, hasAnyContent, hasVisibleContent, search }) =>
    (editing ? hasAnyContent : hasVisibleContent) ? (
      <div className="relative">
        <input
          ref={search.inputRef}
          type="search"
          value={search.query}
          onChange={(e) => search.setQuery(e.target.value)}
          onKeyDown={search.onKeyDown}
          placeholder="Search"
          aria-label="Search applications and bookmarks"
          aria-keyshortcuts="/"
          className="accent-focus w-full rounded-2xl border border-fg/10 bg-fg/[0.04] py-3.5 pr-12 pl-5 text-fg placeholder-fg/30 outline-none backdrop-blur-xl transition-colors"
        />
        {/* The "/" shortcut, advertised where people look for it; hidden
            once typing starts, and on touch where there's no keyboard. */}
        {!search.query && (
          <kbd
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 rounded-md border border-fg/15 px-1.5 py-0.5 font-mono text-xs text-ink-50 pointer-coarse:hidden"
          >
            /
          </kbd>
        )}
      </div>
    ) : null,

  calendar: (widget, { data, q, editing }) => {
    const node = data.nodes[widget.id];
    return !node || (q && !editing) ? null : withTitle(node, widget.hideLabel);
  },

  notes: (widget, { data }) => {
    const notes = instanceOf("notes", widget, data);
    return notes && notes.content.trim() !== "" ? (
      <NotesWidget title={notes.title} content={notes.content} showTitle={!widget.hideLabel} />
    ) : null;
  },

  feed: (widget, { data, q, editing }) => {
    const node = data.nodes[widget.id];
    return !node || (q && !editing) ? null : withTitle(node, widget.hideLabel);
  },

  countdown: (widget, { data }) => {
    const c = instanceOf("countdown", widget, data);
    return c && c.items.some((i) => isValidCountdownDate(i.date)) ? (
      <CountdownWidget title={c.title} items={c.items} showTitle={!widget.hideLabel} />
    ) : null;
  },

  worldClocks: (widget, { data }) => {
    const w = instanceOf("worldClocks", widget, data);
    return w && w.items.some((i) => isValidTimeZone(i.timeZone.trim())) ? (
      <WorldClocksWidget
        title={w.title}
        items={w.items}
        initialNow={data.initialNow}
        showTitle={!widget.hideLabel}
      />
    ) : null;
  },

  systemStats: (widget, { data }) => {
    const w = instanceOf("systemStats", widget, data);
    const stats = data.systemStats[widget.id];
    return w && stats ? (
      <SystemStatsWidget title={w.title} stats={stats} showTitle={!widget.hideLabel} />
    ) : null;
  },

  // An integration's tile (#301), built on the server (lib/widgets/
  // integration-tiles.ts): the same Complication the Monitor face shows,
  // filling its cell. Nothing when there's no tile (none picked, or a guest
  // and the tile is admin-only).
  integration: (widget, { data }) => {
    const tile = data.integrationTiles[widget.id];
    if (!tile) return null;
    const { label, ...content } = tile;
    return <Complication label={label} fill {...content} />;
  },

  // The generic API widget (#302): the server-mapped view.
  api: (widget, { data }) => {
    const w = instanceOf("api", widget, data);
    const result = data.apiViews[widget.id];
    return w && result ? (
      <ApiWidget title={w.title.trim() || "API"} result={result} showTitle={!widget.hideLabel} />
    ) : null;
  },

  favorites: (widget, { q, editing, favoriteApps }) =>
    (!q || editing) && favoriteApps.length > 0 ? (
      <section className="@container">
        {!widget.hideLabel && <SectionTitle>Favorites</SectionTitle>}
        <div className={cardGridClass(widget, "gap-4")}>
          {favoriteApps.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      </section>
    ) : null,

  // Each apps widget shows the apps its filter takes (#299): a group, a tag,
  // the private apps alone or without them. Its title, else "Applications".
  apps: (widget, { data, editing, filteredApps, topMatchId }) => {
    const w = instanceOf("apps", widget, data);
    if (!w) return null;
    const list = (editing ? data.apps : filteredApps).filter((a) => appMatches(a, w.filter));
    if (list.length === 0) return null;
    return (
      <section className="@container">
        {!widget.hideLabel && <SectionTitle>{w.title.trim() || "Applications"}</SectionTitle>}
        <div className={cardGridClass(widget, "gap-4")}>
          {list.map((app) => (
            <AppCard key={app.id} app={app} top={app.id === topMatchId} />
          ))}
        </div>
      </section>
    );
  },

  // A bookmarks widget shows every group, or the one its filter names (#299).
  bookmarks: (widget, { data, editing, filteredGroups, topMatchId }) => {
    const w = instanceOf("bookmarks", widget, data);
    if (!w) return null;
    const all = editing ? groupBookmarks(data.bookmarks, data.groups) : filteredGroups;
    const groups = w.filter.group ? all.filter((g) => g.id === w.filter.group) : all;
    return groups.length > 0 ? (
      <section className="@container">
        {!widget.hideLabel && <SectionTitle>{w.title.trim() || "Bookmarks"}</SectionTitle>}
        <div className={cardGridClass(widget, "gap-6")}>
          {groups.map((g) => (
            <BookmarkGroup key={g.id} name={g.name} items={g.items} topId={topMatchId} />
          ))}
        </div>
      </section>
    ) : null;
  },
};
