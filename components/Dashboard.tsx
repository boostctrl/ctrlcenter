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
import NotesWidget from "./widgets/NotesWidget";
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
  DEFAULT_UI_SCALE,
  CARD_WIDGET_IDS,
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

// What the layout editor edits and autosaves as one unit: the widget list plus
// the site-wide UI scale. Saved together because the settings API replaces the
// stored layout wholesale — a sections-only save would reset the scale.
type EditableLayout = { sections: LayoutWidget[]; scale: number };

// Persist the whole layout; the settings API replaces it wholesale.
async function saveLayout(layout: EditableLayout): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Failed to save layout"));
  }
}

// How many of the 24 columns each widget spans. Complete, static class strings
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
  13: "lg:col-span-13",
  14: "lg:col-span-14",
  15: "lg:col-span-15",
  16: "lg:col-span-16",
  17: "lg:col-span-17",
  18: "lg:col-span-18",
  19: "lg:col-span-19",
  20: "lg:col-span-20",
  21: "lg:col-span-21",
  22: "lg:col-span-22",
  23: "lg:col-span-23",
  24: "lg:col-span-24",
};

// The former header widgets center against whatever shares their row (the old
// header vertically centered the greeting beside the card).
const CELL_ALIGN: Partial<Record<LayoutWidgetId, string>> = {
  greeting: "lg:self-center",
  headerCard: "lg:self-center",
};

// How the inner card/bookmark grids reflow. An explicit `cards` override wins;
// otherwise the count derives from the widget's span (a wide widget, ≥18 of 24
// columns, fits three cards across; a mid one ≥10 two; narrower stacks — the
// same output the old bucket thresholds produced). Overrides still collapse on
// small screens: sm caps at 2 across, everything stacks below sm. Complete,
// static class strings so Tailwind's extractor keeps every variant.
const CARD_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};
const cardsFor = (widget: LayoutWidget): number =>
  widget.cards ?? (widget.span >= 18 ? 3 : widget.span >= 10 ? 2 : 1);
const cardGridClass = (widget: LayoutWidget, gap: string): string =>
  `grid ${gap} ${CARD_COLS[cardsFor(widget)] ?? CARD_COLS[1]}`;

export default function Dashboard({
  widgets,
  scale = DEFAULT_UI_SCALE,
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
  notes,
  feed = null,
}: {
  // The resolved widget arrangement (order + span + hidden), server-resolved so
  // legacy configs render unchanged.
  widgets: LayoutWidget[];
  // The saved UI scale (percent); SSR already renders it on <html>, this seeds
  // the editor's stepper.
  scale?: number;
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
  // The Notes widget's admin-authored title + markdown body.
  notes: { title: string; content: string };
  // The RSS feed widget (rendered server-side and passed in, like `calendar`);
  // null when the feature is off, so its layout cell isn't left empty.
  feed?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { favorites } = useVisitorPrefs();
  const { editing, setEditing } = useEditMode();
  const router = useRouter();

  // The rendered arrangement + UI scale. Client state so editor changes apply
  // instantly; the debounced autosave below persists them. `dirtyRef` gates
  // saving to changes actually made through the editor — the autosave hook
  // watches every state change and this component mounts for every visitor.
  const [layout, setLayout] = useState<EditableLayout>({
    sections: widgets,
    scale,
  });
  const dirtyRef = useRef(false);
  // What Revert restores: the layout as it was when edit mode was entered (the
  // last-saved value would trail the debounced autosave by a beat).
  const entryRef = useRef(layout);
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

  // Keep <html>'s font-size in step with the (possibly just-edited) scale. SSR
  // renders the saved value, so outside editing this is a no-op re-assertion.
  useEffect(() => {
    document.documentElement.style.fontSize =
      layout.scale === DEFAULT_UI_SCALE ? "" : `${layout.scale}%`;
  }, [layout.scale]);

  function mutateLayout(next: EditableLayout) {
    dirtyRef.current = true;
    setLayout(next);
  }
  const mutateSections = (sections: LayoutWidget[]) =>
    mutateLayout({ ...layout, sections });
  const moveWidget = (from: number, to: number) => {
    if (to < 0 || to >= layout.sections.length) return;
    mutateSections(reorder(layout.sections, from, to));
  };
  const setWidgetSpan = (id: LayoutWidgetId, span: number) =>
    mutateSections(
      layout.sections.map((w) =>
        w.id === id
          ? { ...w, span: Math.min(GRID_COLUMNS, Math.max(1, span)) }
          : w
      )
    );
  // Cards per row for the card-grid widgets; undefined returns to auto (the
  // key is dropped so the stored entry stays clean).
  const setWidgetCards = (id: LayoutWidgetId, cards: number | undefined) =>
    mutateSections(
      layout.sections.map((w) => {
        if (w.id !== id) return w;
        if (cards !== undefined) return { ...w, cards };
        const rest = { ...w };
        delete rest.cards;
        return rest;
      })
    );
  const setScale = (next: number) => mutateLayout({ ...layout, scale: next });
  const toggleWidgetHidden = (id: LayoutWidgetId) =>
    mutateSections(
      layout.sections.map((w) =>
        w.id === id ? { ...w, hidden: !w.hidden } : w
      )
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
    () => new Map(layout.sections.map((w) => [w.id, w.hidden])),
    [layout.sections]
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

  // Each widget as a node for its span/cards, or null when it has nothing to
  // show right now (feature off, empty, or hidden during an active search).
  // Hidden widgets are skipped by the render loop in view mode, so this only
  // decides content-existence; in edit mode search filtering and the q-gates
  // are suspended so every widget previews its real content.
  function blockFor(widget: LayoutWidget): React.ReactNode {
    const id = widget.id;
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
      case "notes":
        return notes.content.trim() !== "" ? (
          <NotesWidget title={notes.title} content={notes.content} />
        ) : null;
      case "feed":
        return q && !editing ? null : feed;
      case "favorites":
        return (!q || editing) && favoriteApps.length > 0 ? (
          <section>
            <SectionTitle>Favorites</SectionTitle>
            <div className={cardGridClass(widget, "gap-4")}>
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
            <div className={cardGridClass(widget, "gap-4")}>
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
            <div className={cardGridClass(widget, "gap-6")}>
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
      case "notes":
        return "The note is empty — write it in admin Settings → Notes.";
      case "feed":
        return "The RSS feed is off or has no URL — set it up in admin Settings → RSS feed.";
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
      <div className="grid grid-cols-1 gap-x-8 gap-y-12 lg:grid-cols-24 lg:items-start">
        {layout.sections.map((widget, index) => {
          const node = blockFor(widget);
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
              count={layout.sections.length}
              cellClass={cellClass}
              node={node}
              emptyReason={emptyReason(widget.id)}
              effectiveCards={
                CARD_WIDGET_IDS.includes(widget.id)
                  ? cardsFor(widget)
                  : undefined
              }
              onMove={moveWidget}
              onSpan={setWidgetSpan}
              onCards={setWidgetCards}
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
          scale={layout.scale}
          onScale={setScale}
          onRevert={() => mutateLayout(entryRef.current)}
          onDone={doneEditing}
        />
      )}
    </>
  );
}
