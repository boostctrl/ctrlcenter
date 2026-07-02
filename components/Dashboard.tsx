"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppCard from "./AppCard";
import BookmarkGroup from "./BookmarkGroup";
import Greeting from "./Greeting";
import HeaderCardWidget from "./widgets/HeaderCardWidget";
import ClockWidget from "./widgets/ClockWidget";
import WeatherWidget from "./widgets/WeatherWidget";
import StatusWidget from "./widgets/StatusWidget";
import {
  buildSearchUrl,
  engineLabel,
  resolveBang,
  appBangMap,
  parseBang,
  type SearchConfig,
} from "@/lib/search";
import { orderCategories } from "@/lib/bookmarks";
import { useVisitorPrefs } from "./PrefsProvider";
import SectionTitle from "./SectionTitle";
import type { AppItem, BookmarkItem } from "@/lib/schema";
import type { CurrentWeather } from "@/lib/weather";
import {
  GRID_COLUMNS,
  type LayoutWidget,
  type LayoutWidgetId,
} from "@/lib/layout";
import { useEditMode } from "./EditMode";
import { useAutosave } from "./admin/useAutosave";
import { apiErrorMessage } from "./admin/apiError";
import { reorder } from "./admin/useReorder";
import { WidgetFrame, EditToolbar, useFlowReorder } from "./LayoutEditor";

function groupBookmarks(
  bookmarks: BookmarkItem[],
  categoryOrder: string[]
): [string, BookmarkItem[]][] {
  const map = new Map<string, BookmarkItem[]>();
  for (const bookmark of bookmarks) {
    const list = map.get(bookmark.category) ?? [];
    list.push(bookmark);
    map.set(bookmark.category, list);
  }
  return orderCategories(Array.from(map.keys()), categoryOrder).map((c) => [
    c,
    map.get(c)!,
  ]);
}

// Persist the whole widget list; the settings API replaces layout wholesale.
async function saveLayout(sections: LayoutWidget[]): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout: { sections } }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Failed to save layout"));
  }
}

// How many of the 12 columns each widget spans. Complete, static class strings
// (no interpolation) so Tailwind's extractor keeps every variant.
const COL_SPAN: Record<number, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  8: "lg:col-span-8",
  9: "lg:col-span-9",
  10: "lg:col-span-10",
  11: "lg:col-span-11",
  12: "lg:col-span-12",
};

// The former header widgets center against whatever shares their row (the old
// header vertically centered the greeting beside the card).
const CELL_ALIGN: Partial<Record<LayoutWidgetId, string>> = {
  greeting: "lg:self-center",
  headerCard: "lg:self-center",
};

// How the inner card/bookmark grids reflow with the widget's width. Buckets
// keep the class strings static: a wide widget (≥9 columns) fits three cards
// across, a mid one (5–8) two, a narrow one (≤4) stacks — the same output the
// old full/twoThirds/half/third widths produced.
type SpanBucket = "wide" | "mid" | "narrow";
const bucketFor = (span: number): SpanBucket =>
  span >= 9 ? "wide" : span >= 5 ? "mid" : "narrow";

const CARD_GRID: Record<SpanBucket, string> = {
  wide: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
  mid: "grid grid-cols-1 gap-4 sm:grid-cols-2",
  narrow: "grid grid-cols-1 gap-4",
};
const BOOKMARK_GRID: Record<SpanBucket, string> = {
  wide: "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3",
  mid: "grid grid-cols-1 gap-6 sm:grid-cols-2",
  narrow: "grid grid-cols-1 gap-6",
};

export default function Dashboard({
  widgets,
  apps,
  bookmarks,
  search,
  categoryOrder = [],
  calendar = null,
  initialDate,
  initialGreeting,
  initialWeather,
  weatherEnabled,
  showClock,
  statusEnabled,
}: {
  // The resolved widget arrangement (order + span + hidden), server-resolved so
  // legacy configs render unchanged.
  widgets: LayoutWidget[];
  apps: AppItem[];
  bookmarks: BookmarkItem[];
  search: SearchConfig;
  categoryOrder?: string[];
  // The calendar widget (rendered server-side and passed in); hidden during an
  // active search so results stay adjacent to the input. Passed as null when the
  // widget wouldn't render, so its layout cell isn't left empty.
  calendar?: React.ReactNode;
  // Server-computed seeds for the header widgets (admin default tz / location),
  // updated client-side to the visitor's effective prefs after mount.
  initialDate: string;
  initialGreeting: string;
  initialWeather: CurrentWeather | null;
  weatherEnabled: boolean;
  showClock: boolean;
  statusEnabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { favorites } = useVisitorPrefs();
  const { editing, setEditing } = useEditMode();
  const router = useRouter();

  // The rendered arrangement. Client state so editor changes apply instantly;
  // the debounced autosave below persists them. `dirtyRef` gates saving to
  // changes actually made through the editor — the autosave hook watches every
  // state change and this component mounts for every visitor.
  const [layout, setLayout] = useState(widgets);
  const dirtyRef = useRef(false);
  // What Revert restores: the layout as it was when edit mode was entered (the
  // last-saved value would trail the debounced autosave by a beat).
  const entryRef = useRef(widgets);
  useEffect(() => {
    if (editing) entryRef.current = layout;
    // Snapshot only when edit mode is entered — not again on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const { status: saveStatus, error: saveError } = useAutosave(
    layout,
    async (value) => {
      if (!dirtyRef.current) return;
      await saveLayout(value);
    }
  );

  function mutateLayout(next: LayoutWidget[]) {
    dirtyRef.current = true;
    setLayout(next);
  }
  const moveWidget = (from: number, to: number) => {
    if (to < 0 || to >= layout.length) return;
    mutateLayout(reorder(layout, from, to));
  };
  const setWidgetSpan = (id: LayoutWidgetId, span: number) =>
    mutateLayout(
      layout.map((w) =>
        w.id === id
          ? { ...w, span: Math.min(GRID_COLUMNS, Math.max(1, span)) }
          : w
      )
    );
  const toggleWidgetHidden = (id: LayoutWidgetId) =>
    mutateLayout(
      layout.map((w) => (w.id === id ? { ...w, hidden: !w.hidden } : w))
    );
  const { handlers, dragIndex, over } = useFlowReorder(moveWidget);

  function doneEditing() {
    setEditing(false);
    // Drop a stale ?edit=1 (the deep link from admin Settings) so a reload
    // doesn't reopen the editor.
    if (window.location.search.includes("edit="))
      router.replace("/", { scroll: false });
  }

  const hiddenById = useMemo(
    () => new Map(layout.map((w) => [w.id, w.hidden])),
    [layout]
  );
  const showApps = !hiddenById.get("apps");
  const showBookmarks = !hiddenById.get("bookmarks");

  // "/" focuses search; Escape clears and blurs it. Parked while editing so the
  // hotkey can't fight the editor's controls.
  useEffect(() => {
    if (editing) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape" && target === inputRef.current) {
        setQuery("");
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing]);

  const q = query.trim().toLowerCase();

  // A leading `!bang` puts the search bar in "command" mode: the query targets a
  // bang destination rather than filtering apps/bookmarks.
  const appBangs = useMemo(
    () =>
      appBangMap(
        apps.map((a) => ({ name: a.name, subtitle: a.subtitle, url: a.url }))
      ),
    [apps]
  );
  const parsedBang = useMemo(() => parseBang(query), [query]);
  const bangHit = useMemo(
    () => resolveBang(query, search.bangs ?? [], appBangs),
    [query, search.bangs, appBangs]
  );

  const filteredApps = useMemo(() => {
    if (!showApps) return [];
    if (!q) return apps;
    return apps.filter((a) =>
      [a.name, a.subtitle, a.url].some((f) => f.toLowerCase().includes(q))
    );
  }, [apps, q, showApps]);

  const filteredGroups = useMemo(() => {
    if (!showBookmarks) return [];
    const matches = !q
      ? bookmarks
      : bookmarks.filter((b) =>
          [b.name, b.category, b.url].some((f) => f.toLowerCase().includes(q))
        );
    return groupBookmarks(matches, categoryOrder);
  }, [bookmarks, q, categoryOrder, showBookmarks]);

  // Pinned apps, in pin order, dropping any that no longer exist. Shown only when
  // not searching — during a search the filtered results take over.
  const favoriteApps = useMemo(() => {
    const byId = new Map(apps.map((a) => [a.id, a]));
    return favorites
      .map((id) => byId.get(id))
      .filter((a): a is AppItem => a !== undefined);
  }, [apps, favorites]);

  // Whether there's anything configured at all (drives the empty-state) vs.
  // anything the admin's left visible to search (drives the search bar/messages).
  const hasAnyContent = apps.length > 0 || bookmarks.length > 0;
  const hasVisibleContent =
    (showApps && apps.length > 0) || (showBookmarks && bookmarks.length > 0);
  const hasResults = filteredApps.length > 0 || filteredGroups.length > 0;

  function topResultUrl(): string | null {
    if (filteredApps.length > 0) return filteredApps[0].url;
    const firstGroup = filteredGroups[0];
    return firstGroup?.[1][0]?.url ?? null;
  }

  function webSearch() {
    const url = buildSearchUrl(search, query);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  // Enter: a recognized bang wins, then the top app/bookmark match, then a web
  // search of the query.
  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || !q) return;
    if (bangHit) {
      window.open(bangHit.url, "_blank", "noopener,noreferrer");
      return;
    }
    const top = topResultUrl();
    if (top) {
      window.open(top, "_blank", "noopener,noreferrer");
    } else {
      webSearch();
    }
  }

  // Each widget as a node for a given span, or null when it has nothing to show
  // right now (feature off, empty, or hidden during an active search). Hidden
  // widgets are skipped by the render loop in view mode, so this only decides
  // content-existence; in edit mode search filtering and the q-gates are
  // suspended so every widget previews its real content.
  function blockFor(id: LayoutWidgetId, span: number): React.ReactNode {
    switch (id) {
      case "greeting":
        return <Greeting initialGreeting={initialGreeting} />;
      case "headerCard":
        return showClock || weatherEnabled || statusEnabled ? (
          <HeaderCardWidget
            initialDate={initialDate}
            initialWeather={initialWeather}
            weatherEnabled={weatherEnabled}
            showClock={showClock}
            statusEnabled={statusEnabled}
            apps={apps}
          />
        ) : null;
      case "clock":
        return showClock ? (
          <ClockWidget initialDate={initialDate} showClock={showClock} />
        ) : null;
      case "weather":
        return weatherEnabled ? (
          <WeatherWidget
            initialWeather={initialWeather}
            weatherEnabled={weatherEnabled}
          />
        ) : null;
      case "status":
        return statusEnabled ? (
          <StatusWidget statusEnabled={statusEnabled} apps={apps} />
        ) : null;
      case "search":
        return (editing ? hasAnyContent : hasVisibleContent) ? (
          <div className="relative">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search"
              aria-label="Search applications and bookmarks"
              className="accent-focus w-full rounded-2xl border border-fg/10 bg-fg/[0.04] px-5 py-3.5 text-fg placeholder-fg/30 outline-none backdrop-blur-xl transition-colors"
            />
          </div>
        ) : null;
      case "calendar":
        return q && !editing ? null : calendar;
      case "favorites":
        return (!q || editing) && favoriteApps.length > 0 ? (
          <section>
            <SectionTitle>Favorites</SectionTitle>
            <div className={CARD_GRID[bucketFor(span)]}>
              {favoriteApps.map((app) => (
                <AppCard key={app.id} app={app} />
              ))}
            </div>
          </section>
        ) : null;
      case "apps": {
        const list = editing ? apps : filteredApps;
        return list.length > 0 ? (
          <section>
            <SectionTitle>Applications</SectionTitle>
            <div className={CARD_GRID[bucketFor(span)]}>
              {list.map((app) => (
                <AppCard key={app.id} app={app} />
              ))}
            </div>
          </section>
        ) : null;
      }
      case "bookmarks": {
        const groups = editing
          ? groupBookmarks(bookmarks, categoryOrder)
          : filteredGroups;
        return groups.length > 0 ? (
          <section>
            <SectionTitle>Bookmarks</SectionTitle>
            <div className={BOOKMARK_GRID[bucketFor(span)]}>
              {groups.map(([category, items]) => (
                <BookmarkGroup key={category} category={category} items={items} />
              ))}
            </div>
          </section>
        ) : null;
      }
      default:
        return null;
    }
  }

  // Why a widget's cell is empty right now — shown in its edit-mode placeholder.
  function emptyReason(id: LayoutWidgetId): string {
    switch (id) {
      case "headerCard":
        return "Everything this card shows is off — enable the clock, weather, or status checks.";
      case "clock":
        return "Date & clock is toggled off in the admin Layout settings.";
      case "weather":
        return "Weather is disabled in the admin Weather settings.";
      case "status":
        return statusEnabled
          ? "Waiting for the first status check…"
          : "Status checks are off, or there are no apps to monitor.";
      case "search":
        return "The search bar appears once there are apps or bookmarks to search.";
      case "calendar":
        return "The calendar is disabled, or it has no upcoming events to show.";
      case "favorites":
        return "No pinned favorites yet.";
      case "apps":
        return "No applications yet — add them in the admin portal.";
      case "bookmarks":
        return "No bookmarks yet — add them in the admin portal.";
      default:
        return "Nothing to show yet.";
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-x-8 gap-y-12 lg:grid-cols-12 lg:items-start">
        {layout.map((widget, index) => {
          const node = blockFor(widget.id, widget.span);
          const cellClass = `${COL_SPAN[widget.span]} ${CELL_ALIGN[widget.id] ?? ""}`;
          if (!editing) {
            if (widget.hidden || !node) return null;
            return (
              <div key={widget.id} className={cellClass}>
                {node}
              </div>
            );
          }
          return (
            <WidgetFrame
              key={widget.id}
              widget={widget}
              index={index}
              count={layout.length}
              cellClass={cellClass}
              node={node}
              emptyReason={emptyReason(widget.id)}
              onMove={moveWidget}
              onSpan={setWidgetSpan}
              onToggleHidden={toggleWidgetHidden}
              dragHandlers={handlers(index)}
              dragging={dragIndex === index}
              dropSide={
                over?.index === index && dragIndex !== index ? over.side : null
              }
            />
          );
        })}
      </div>

      {!editing && hasVisibleContent && !hasResults && parsedBang && (
        <p className="text-fg/50">
          {bangHit ? (
            <>
              <span className="text-fg/40">↵</span>{" "}
              {bangHit.term
                ? `Search ${bangHit.label} for “${bangHit.term}”`
                : `Open ${bangHit.label}`}
            </>
          ) : (
            <span className="text-fg/40">
              No bang “!{parsedBang.key}”. Press Enter to search the web.
            </span>
          )}
        </p>
      )}

      {!editing && hasVisibleContent && !hasResults && !parsedBang && (
        <p className="text-fg/40">
          No matches for “{query}”.{" "}
          {buildSearchUrl(search, query) && (
            <button
              type="button"
              onClick={webSearch}
              className="text-fg/60 underline transition-colors hover:text-fg/90"
            >
              Search {engineLabel(search)} for “{query}” →
            </button>
          )}
        </p>
      )}

      {!editing && !hasAnyContent && (
        <p className="text-fg/40">
          Nothing here yet.{" "}
          <Link href="/admin" className="underline hover:text-fg/70">
            Add your first app or bookmark
          </Link>
          .
        </p>
      )}

      {editing && (
        <EditToolbar
          status={saveStatus}
          error={saveError}
          onRevert={() => mutateLayout(entryRef.current)}
          onDone={doneEditing}
        />
      )}
    </>
  );
}
