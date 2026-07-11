"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import CountdownWidget, {
  isValidCountdownDate,
  type CountdownItem,
} from "./widgets/CountdownWidget";
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
  DEFAULT_GRID_GAP,
  DEFAULT_TOP_GAP,
  DEFAULT_WIDGETS,
  smallScreenTopGap,
  CARD_WIDGET_IDS,
  TITLED_WIDGET_IDS,
  SIZED_WIDGET_IDS,
  WIDGET_LABELS,
  fillSpan,
  type LayoutWidget,
  type LayoutWidgetId,
  type SpaceSide,
} from "@/lib/layout";
import { useEditMode } from "./EditMode";
import { ConfirmProvider } from "./admin/Confirm";
import { useAutosave, type SaveOptions } from "./admin/useAutosave";
import { apiErrorMessage } from "./admin/apiError";
import { reorder } from "./admin/useReorder";
import { WidgetFrame, EditToolbar, useFlowReorder } from "./LayoutEditor";
import { useGridLayout } from "./useGridLayout";

// Apply the per-widget label toggle to a widget passed in as a pre-rendered
// node (the calendar and feed are built in app/page.tsx). Cloning lets the
// toggle preview live in the editor without re-fetching their server data.
function withTitle(node: React.ReactNode, hideLabel?: boolean): React.ReactNode {
  return isValidElement(node)
    ? cloneElement(node as React.ReactElement<{ showTitle?: boolean }>, {
        showTitle: !hideLabel,
      })
    : node;
}

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
// the site-wide UI scale, the grid's vertical gap, and the page's top gap.
// Saved together because the settings API replaces the stored layout wholesale
// — a sections-only save would reset the page-level values.
type EditableLayout = {
  sections: LayoutWidget[];
  scale: number;
  gap: number;
  topGap: number;
};

// Undo (Ctrl+Z) granularity: rapid consecutive changes — a resize drag's
// per-column steps, a held stepper — coalesce into the entry pushed by the
// burst's first change, so one undo takes back the whole gesture rather than
// its last increment. The stack is bounded; the oldest steps fall off.
const UNDO_COALESCE_MS = 800;
const UNDO_LIMIT = 50;

// Whether the change happening now starts a new undo step (true) or coalesces
// into the burst in progress (false), advancing the burst clock either way.
function takeUndoSnapshot(timing: { lastPush: number }): boolean {
  const now = Date.now();
  const take = now - timing.lastPush > UNDO_COALESCE_MS;
  timing.lastPush = now;
  return take;
}

// Persist the whole layout; the settings API replaces it wholesale.
async function saveLayout(layout: EditableLayout, opts?: SaveOptions): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout }),
    keepalive: opts?.keepalive,
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
// same output the old bucket thresholds produced). The count is a cap: the
// steps are container queries against the widget's own width (the section
// around each grid is the @container), not viewport media queries — tile width
// is a function of the card, and span, the page max-width, and the UI scale
// all move it independently of the viewport (#145). The 3- and 4-column rungs
// keep tiles at roughly ≥235px — derived from the tile's CONTENT (an icon
// plus a two-word name), not just its box — and titles get a second line
// before ellipsizing (see AppCard), so the 2-column floor can stay denser.
// Rem-based thresholds track the UI scale, so a scaled-up dashboard collapses
// proportionally sooner. Complete, static class strings so Tailwind's
// extractor keeps every variant.
const CARD_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 @md:grid-cols-2",
  3: "grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-3",
  4: "grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4",
};
const cardsFor = (widget: LayoutWidget): number =>
  widget.cards ?? (widget.span >= 18 ? 3 : widget.span >= 10 ? 2 : 1);
const cardGridClass = (widget: LayoutWidget, gap: string): string =>
  `grid ${gap} ${CARD_COLS[cardsFor(widget)] ?? CARD_COLS[1]}`;

export default function Dashboard({
  widgets,
  scale = DEFAULT_UI_SCALE,
  gap = DEFAULT_GRID_GAP,
  topGap = DEFAULT_TOP_GAP,
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
  countdown,
}: {
  // The resolved widget arrangement (order + span + hidden), server-resolved so
  // legacy configs render unchanged.
  widgets: LayoutWidget[];
  // The saved UI scale (percent); SSR already renders it on <html>, this seeds
  // the editor's stepper.
  scale?: number;
  // The saved grid gap (px) between cards; seeds the editor's gap stepper.
  gap?: number;
  // The saved gap (px) above the first widget row; SSR renders it on <main>'s
  // CSS variables, this seeds the editor's stepper.
  topGap?: number;
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
  // The Countdown widget's admin-authored title + dated rows.
  countdown: { title: string; items: CountdownItem[] };
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
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
    gap,
    topGap,
  });
  const dirtyRef = useRef(false);
  // What Revert restores: the layout as it was when edit mode was entered (the
  // last-saved value would trail the debounced autosave by a beat).
  const entryRef = useRef(layout);
  // The undo stack: past layouts, most recent last. Lives in a ref (it's only
  // touched from event handlers); `canUndo` mirrors its non-emptiness as state
  // so the toolbar's Undo button re-renders with it. The stack only grows
  // through the editor's controls, so clearing it when editing ends (see
  // doneEditing — the mode's only exit) is what keeps Ctrl+Z from reaching
  // back into a finished session.
  const undoRef = useRef<EditableLayout[]>([]);
  const undoTimingRef = useRef({ lastPush: 0 });
  const [canUndo, setCanUndo] = useState(false);
  useEffect(() => {
    if (editing) entryRef.current = layout;
    // Snapshot only when edit mode is entered — not again on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const { status: saveStatus, error: saveError } = useAutosave(
    layout,
    async (value, opts) => {
      if (!dirtyRef.current) return;
      await saveLayout(value, opts);
    }
  );

  // Keep <html>'s font-size in step with the (possibly just-edited) scale. SSR
  // renders the saved value, so outside editing this is a no-op re-assertion.
  useEffect(() => {
    document.documentElement.style.fontSize =
      layout.scale === DEFAULT_UI_SCALE ? "" : `${layout.scale}%`;
  }, [layout.scale]);

  // Keep <main>'s top-gap variables in step the same way (app/page.tsx SSRs
  // them; the padding classes live there too).
  useEffect(() => {
    const main = gridRef.current?.closest("main");
    if (!main) return;
    main.style.setProperty(
      "--top-gap",
      `${smallScreenTopGap(layout.topGap)}px`
    );
    main.style.setProperty("--top-gap-lg", `${layout.topGap}px`);
  }, [layout.topGap]);

  function mutateLayout(next: EditableLayout) {
    if (takeUndoSnapshot(undoTimingRef.current)) {
      undoRef.current.push(layout);
      if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
      setCanUndo(true);
    }
    dirtyRef.current = true;
    setLayout(next);
  }
  const undoLast = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    // The next change starts a fresh undo step instead of coalescing into the
    // burst that just got undone.
    undoTimingRef.current.lastPush = 0;
    setCanUndo(undoRef.current.length > 0);
    dirtyRef.current = true;
    setLayout(prev);
  }, []);
  // Revert and Reset are discrete actions: always their own undo step, so
  // Ctrl+Z can take either back even right after another change.
  function revertLayout() {
    undoTimingRef.current.lastPush = 0;
    mutateLayout(entryRef.current);
  }
  function resetLayout() {
    undoTimingRef.current.lastPush = 0;
    mutateLayout({
      sections: DEFAULT_WIDGETS.map((w) => ({ ...w })),
      scale: DEFAULT_UI_SCALE,
      gap: DEFAULT_GRID_GAP,
      topGap: DEFAULT_TOP_GAP,
    });
  }
  const mutateSections = (sections: LayoutWidget[]) =>
    mutateLayout({ ...layout, sections });
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
  // Explicit height (px) for any widget; undefined clears it back to auto (the
  // key is dropped so the stored entry stays clean, like `cards`).
  const setWidgetHeight = (id: LayoutWidgetId, height: number | undefined) =>
    mutateSections(
      layout.sections.map((w) => {
        if (w.id !== id) return w;
        if (height !== undefined) return { ...w, height };
        const rest = { ...w };
        delete rest.height;
        return rest;
      })
    );
  // Extra space (px) on one side of a widget; undefined/0 clears that side. An
  // emptied `space` object is dropped so stored entries stay clean (like cards).
  const setWidgetSpace = (
    id: LayoutWidgetId,
    side: SpaceSide,
    value: number | undefined
  ) =>
    mutateSections(
      layout.sections.map((w) => {
        if (w.id !== id) return w;
        const nextSpace = { ...(w.space ?? {}) };
        if (value) nextSpace[side] = value;
        else delete nextSpace[side];
        const rest = { ...w };
        if (Object.keys(nextSpace).length > 0) rest.space = nextSpace;
        else delete rest.space;
        return rest;
      })
    );
  const setScale = (next: number) => mutateLayout({ ...layout, scale: next });
  const setGap = (next: number) => mutateLayout({ ...layout, gap: next });
  const setTopGap = (next: number) =>
    mutateLayout({ ...layout, topGap: next });
  const toggleWidgetHidden = (id: LayoutWidgetId) =>
    mutateSections(
      layout.sections.map((w) =>
        w.id === id ? { ...w, hidden: !w.hidden } : w
      )
    );
  // Toggle the section heading. Stored only when off (the key is dropped when
  // turning it back on) so entries stay clean, like `cards`.
  const toggleWidgetLabel = (id: LayoutWidgetId) =>
    mutateSections(
      layout.sections.map((w) => {
        if (w.id !== id) return w;
        if (w.hideLabel) {
          const rest = { ...w };
          delete rest.hideLabel;
          return rest;
        }
        return { ...w, hideLabel: true };
      })
    );
  const { gripHandlers, dropHandlers, dragIndex, over } =
    useFlowReorder(moveVisible);
  // Drives the grid's vertical layout: deterministic masonry packing on lg+ (in
  // both the editor and the live page, so the preview matches), single-column
  // flow below lg — honoring the grid gap, per-widget heights and per-side
  // space. The signature (which includes edit mode, since the editor's frames
  // are taller than live cards) re-runs it when any of those change.
  const gridSignature =
    `${layout.gap}|${editing ? 1 : 0}|` +
    layout.sections
      .map((w) => {
        const s = w.space ?? {};
        return `${w.id}:${w.span}:${w.hidden ? 1 : 0}:${w.height ?? ""}:${s.top ?? ""}.${s.right ?? ""}.${s.bottom ?? ""}.${s.left ?? ""}`;
      })
      .join(",");
  useGridLayout(gridRef, layout.gap, gridSignature);

  const doneEditing = useCallback(() => {
    setEditing(false);
    undoRef.current = [];
    undoTimingRef.current.lastPush = 0;
    setCanUndo(false);
    // Drop a stale ?edit=1 (the deep link from admin Settings) so a reload
    // doesn't reopen the editor.
    if (window.location.search.includes("edit="))
      router.replace("/", { scroll: false });
  }, [setEditing, router]);

  const hiddenById = useMemo(
    () => new Map(layout.sections.map((w) => [w.id, w.hidden])),
    [layout.sections]
  );
  const showApps = !hiddenById.get("apps");
  const showBookmarks = !hiddenById.get("bookmarks");

  // Editing hotkeys: Ctrl/Cmd+Z undoes the last layout change; Escape exits
  // edit mode like Done — unless a layered surface should eat it first (an
  // open More popover, the reset confirm dialog), whose own handlers close it.
  // Capture phase, so the open-popover check runs before those document-level
  // handlers have closed anything.
  useEffect(() => {
    if (!editing) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoLast();
        return;
      }
      if (e.key === "Escape") {
        if (gridRef.current?.querySelector("details[open]")) return;
        if (document.querySelector('[role="alertdialog"]')) return;
        doneEditing();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editing, undoLast, doneEditing]);

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
        return q && !editing ? null : withTitle(calendar, widget.hideLabel);
      case "notes":
        return notes.content.trim() !== "" ? (
          <NotesWidget
            title={notes.title}
            content={notes.content}
            showTitle={!widget.hideLabel}
          />
        ) : null;
      case "feed":
        return q && !editing ? null : withTitle(feed, widget.hideLabel);
      case "countdown":
        return countdown.items.some((i) => isValidCountdownDate(i.date)) ? (
          <CountdownWidget
            title={countdown.title}
            items={countdown.items}
            showTitle={!widget.hideLabel}
          />
        ) : null;
      case "favorites":
        return (!q || editing) && favoriteApps.length > 0 ? (
          <section className="@container">
            {!widget.hideLabel && <SectionTitle>Favorites</SectionTitle>}
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
          <section className="@container">
            {!widget.hideLabel && <SectionTitle>Applications</SectionTitle>}
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
          <section className="@container">
            {!widget.hideLabel && <SectionTitle>Bookmarks</SectionTitle>}
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
        return "Everything this card shows is off — enable the clock, weather, or status checks. The separate Clock, Weather and Status widgets are an alternative to this combined card.";
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
      case "countdown":
        return "No dates yet — add them in admin Settings → Countdown.";
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

  // Every widget with its rendered node. Only the visible cells — not hidden,
  // with content — enter the grid, in BOTH modes: previously edit mode gave
  // hidden and empty widgets full-size phantom cells, so with anything hidden
  // (a fresh install always has some) the editor's height and row structure
  // stopped matching the live page (#98). They collapse into the tray below
  // the grid instead.
  const cells = layout.sections.map((widget) => ({
    widget,
    node: blockFor(widget),
  }));
  const liveCells = cells.filter(({ widget, node }) => !widget.hidden && node !== null);
  const trayCells = cells.filter(({ widget, node }) => widget.hidden || node === null);
  const liveWidgets = liveCells.map(({ widget }) => widget);

  // Reorder within the visible flow — MoveButtons and drag both hand in
  // visible indices. Tray widgets keep their slots in the stored order while
  // the visible ones permute through the remaining positions, so a one-step
  // move is always a visible change, never a silent swap with a tray widget.
  function moveVisible(fromV: number, toV: number) {
    if (toV < 0 || toV >= liveCells.length) return;
    const liveIds = new Set(liveWidgets.map((w) => w.id));
    const nextVisible = reorder(liveWidgets, fromV, toV);
    let vi = 0;
    mutateSections(
      layout.sections.map((w) => (liveIds.has(w.id) ? nextVisible[vi++] : w))
    );
  }

  return (
    <>
      {/* Vertical layout (row-gap, per-cell row-span and margins) is driven by
          useGridLayout, not this class — the gap-y here is only a pre-hydration
          fallback. Sparse (non-dense) flow keeps cards in the order they're
          placed while still packing them up their columns, so the arrangement is
          deterministic and the editor previews exactly what ships. */}
      <div
        ref={gridRef}
        className="grid grid-cols-1 gap-x-8 gap-y-8 lg:grid-cols-24 lg:items-start"
      >
        {liveCells.map(({ widget, node }, vIndex) => {
          const cellClass = `${COL_SPAN[widget.span]} ${CELL_ALIGN[widget.id] ?? ""}`;
          // An explicit height sizes the cell exactly: content widgets scroll
          // their overflow, the others center their content (so a sized greeting
          // sits centered beside the header card, restoring the classic header).
          // Scrolling widgets keep their height at every size — they can't clip.
          // The centering ones take it on lg+ only, like spans: below lg cells
          // stack full-width, contents grow taller (the header card's rows
          // stack), and a height tuned against the desktop row would silently
          // crop them (#105) — auto height is what a phone wants there.
          const scrolls = SIZED_WIDGET_IDS.includes(widget.id);
          const heightStyle = widget.height
            ? scrolls
              ? { height: widget.height }
              : ({
                  "--widget-height": `${widget.height}px`,
                } as React.CSSProperties)
            : undefined;
          const heightClass = widget.height
            ? scrolls
              ? "overflow-y-auto"
              : "lg:flex lg:h-[var(--widget-height)] lg:flex-col lg:justify-center lg:overflow-hidden"
            : "";
          if (!editing) {
            return (
              <div
                key={widget.id}
                className={`${cellClass} ${heightClass}`}
                style={heightStyle}
                data-space-top={widget.space?.top || undefined}
                data-space-right={widget.space?.right || undefined}
                data-space-bottom={widget.space?.bottom || undefined}
                data-space-left={widget.space?.left || undefined}
              >
                {node}
              </div>
            );
          }
          return (
            <WidgetFrame
              key={widget.id}
              widget={widget}
              index={vIndex}
              count={liveCells.length}
              cellClass={cellClass}
              node={node}
              effectiveCards={
                CARD_WIDGET_IDS.includes(widget.id)
                  ? cardsFor(widget)
                  : undefined
              }
              fillTo={fillSpan(liveWidgets, vIndex)}
              titled={TITLED_WIDGET_IDS.includes(widget.id)}
              previewStyle={heightStyle}
              previewClass={heightClass}
              onMove={moveVisible}
              onSpan={setWidgetSpan}
              onCards={setWidgetCards}
              onHeight={setWidgetHeight}
              onSpace={setWidgetSpace}
              onToggleHidden={toggleWidgetHidden}
              onToggleLabel={toggleWidgetLabel}
              gripHandlers={gripHandlers(vIndex)}
              dropHandlers={dropHandlers(vIndex)}
              dragging={dragIndex === vIndex}
              drop={
                over?.index === vIndex && dragIndex !== vIndex
                  ? { side: over.side, axis: over.axis }
                  : null
              }
            />
          );
        })}
      </div>

      {/* Widgets the live page doesn't render, kept discoverable while editing:
          hidden ones can be shown (then placed in the grid above), empty ones
          say what would give them content. */}
      {editing && trayCells.length > 0 && (
        <div className="rounded-2xl border border-dashed border-fg/15 p-4">
          <p className="text-xs font-medium text-fg/70">Not on the live page</p>
          <p className="mt-0.5 max-w-prose text-xs text-fg/55">
            These widgets don&apos;t render for visitors right now — hidden ones
            by choice, empty ones until they have something to show. The grid
            above packs exactly like the live page. Show a hidden widget to
            place it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {trayCells.map(({ widget, node }) => (
              <div
                key={widget.id}
                title={node === null ? emptyReason(widget.id) : undefined}
                className="flex items-center gap-2 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 text-xs text-fg/60"
              >
                <span className="font-medium">{WIDGET_LABELS[widget.id]}</span>
                <span className="rounded bg-fg/10 px-1.5 py-0.5 text-[10px] tracking-wide text-fg/60 uppercase">
                  {widget.hidden ? "Hidden" : "Empty"}
                </span>
                {widget.hidden ? (
                  <button
                    type="button"
                    onClick={() => toggleWidgetHidden(widget.id)}
                    className="rounded-md border border-fg/10 px-2 py-0.5 text-fg/70 transition-colors hover:bg-fg/10 hover:text-fg"
                  >
                    Show
                  </button>
                ) : (
                  <span className="max-w-72 truncate text-fg/55">
                    {emptyReason(widget.id)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
        <ConfirmProvider>
          <EditToolbar
            status={saveStatus}
            error={saveError}
            scale={layout.scale}
            onScale={setScale}
            gap={layout.gap}
            onGap={setGap}
            topGap={layout.topGap}
            onTopGap={setTopGap}
            canUndo={canUndo}
            onUndo={undoLast}
            onRevert={revertLayout}
            onReset={resetLayout}
            onDone={doneEditing}
          />
        </ConfirmProvider>
      )}
    </>
  );
}
