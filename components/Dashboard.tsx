"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  buildSearchUrl,
  engineLabel,
  resolveBang,
  appBangMap,
  parseBang,
} from "@/lib/search";
import { appMatches, groupBookmarks, groupName } from "@/lib/groups";
import { useFavorites } from "./PrefsProvider";
import type { AppItem, InstanceOf } from "@/lib/schema";
import {
  DEFAULT_UI_SCALE,
  DEFAULT_GRID_GAP,
  DEFAULT_TOP_GAP,
  CARD_WIDGET_TYPES,
  TITLED_WIDGET_TYPES,
  SIZED_WIDGET_TYPES,
  WIDGET_LABELS,
  fillSpan,
  type LayoutWidget,
  type WidgetType,
} from "@/lib/layout";
import { useEditMode } from "./EditMode";
import { ConfirmProvider } from "./admin/Confirm";
import { reorder } from "./admin/useReorder";
import { WidgetFrame, EditToolbar, DragGhost } from "./LayoutEditor";
import { usePointerReorder } from "./usePointerReorder";
import WidgetPalette from "./WidgetPalette";
import BoardsMenu, { type EditorBoard } from "./BoardsMenu";
import { createWidget } from "./admin/settingsApi";

// The widget settings panel (#303) loads only when the admin opens it, so
// visitors never download the editors.
const WidgetPanel = dynamic(() => import("./WidgetPanel"), { ssr: false });
import { useGridLayout } from "./useGridLayout";
import { useLayoutEditor } from "./useLayoutEditor";
import { UndoGestureContext } from "./useUndoHistory";
import { emptyReason as widgetEmptyReason, widgetDef } from "@/lib/widgets/defs";
import type { HomeData } from "@/lib/widgets/data";
import { WIDGET_RENDERERS, cardsFor, type WidgetRenderContext } from "./widgets/registry";




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



export default function Dashboard({
  boardId,
  isHome,
  boards = [],
  widgets,
  scale = DEFAULT_UI_SCALE,
  gap = DEFAULT_GRID_GAP,
  topGap = DEFAULT_TOP_GAP,
  data,
}: {
  // The board shown (#298), and whether it's the first board (Reset's target).
  boardId: string;
  isHome: boolean;
  // Every board, for the editor's board menu (#303); empty for visitors.
  boards?: EditorBoard[];
  // The board's resolved widget arrangement (order + span + hidden).
  widgets: LayoutWidget[];
  // The saved UI scale (percent); SSR already renders it on <html>, this seeds
  // the editor's stepper.
  scale?: number;
  // The saved grid gap (px) between cards; seeds the editor's gap stepper.
  gap?: number;
  // The saved gap (px) above the first widget row; SSR renders it on <main>'s
  // CSS variables, this seeds the editor's stepper.
  topGap?: number;
  // Everything the widgets render, built server-side (lib/widgets/load.tsx).
  data: HomeData;
}) {
  const { apps, bookmarks, search, groups, statusEnabled, labels } = data;
  const [query, setQuery] = useState("");
  // The search widget renders through the registry and hands its <input>
  // back here (for the "/" hotkey); the state setter is the callback ref.
  const [searchInput, setSearchInput] = useState<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // The tray of widgets not on the live page (edit mode), a drop target too.
  const trayRef = useRef<HTMLDivElement>(null);
  const { favorites } = useFavorites();
  const { editing, setEditing } = useEditMode();

  const {
    layout,
    canUndo,
    canRedo,
    undoLast,
    redoLast,
    gesture,
    selectedId,
    select,
    doneEditing,
    revertLayout,
    resetLayout,
    mutateSections,
    setWidgetSpan,
    setWidgetCards,
    setWidgetHeight,
    setWidgetSpace,
    setScale,
    setGap,
    setTopGap,
    toggleWidgetHidden,
    toggleWidgetLabel,
    saveStatus,
    saveError,
  } = useLayoutEditor({
    boardId,
    isHome,
    initial: { sections: widgets, scale, gap, topGap },
    editing,
    setEditing,
    gridRef,
  });
  // Moving cards by dragging them (#312): nothing changes until the drop.
  const pointer = usePointerReorder({
    enabled: editing,
    gridRef,
    trayRef,
    onMove: (id, from, to) => {
      moveVisible(from, to);
      select(id);
    },
    onHide: (id) => showOrHide(id),
    onPlace: (id, to) => placeFromTray(id, to),
  });
  const cardDrag = pointer.drag;
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


  // The apps and bookmarks the visible apps / bookmarks widgets show,
  // through each one's filter (#299): search only covers what the board
  // shows.
  const appsFilters = layout.sections
    .filter((w) => w.type === "apps" && !w.hidden)
    .flatMap((w) => {
      const inst = data.instances[w.id] as InstanceOf<"apps"> | undefined;
      return inst ? [inst.filter] : [];
    });
  const bookmarkFilters = layout.sections
    .filter((w) => w.type === "bookmarks" && !w.hidden)
    .flatMap((w) => {
      const inst = data.instances[w.id] as InstanceOf<"bookmarks"> | undefined;
      return inst ? [inst.filter] : [];
    });
  const filterKey = JSON.stringify([appsFilters, bookmarkFilters]);
  const shownApps = useMemo(
    () => apps.filter((a) => appsFilters.some((f) => appMatches(a, f))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apps, filterKey]
  );
  const shownBookmarks = useMemo(
    () =>
      bookmarkFilters.some((f) => !f.group)
        ? bookmarks
        : bookmarks.filter((b) => bookmarkFilters.some((f) => f.group === b.group)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookmarks, filterKey]
  );
  // An instance's label (its title, else the type's) for the editor frame/tray.
  const labelFor = (widget: LayoutWidget): string =>
    labels[widget.id] ?? WIDGET_LABELS[widget.type];


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
        searchInput?.focus();
      } else if (e.key === "Escape" && target === searchInput) {
        setQuery("");
        searchInput?.blur();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, searchInput]);

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
    if (!q) return shownApps;
    return shownApps.filter((a) =>
      [a.name, a.subtitle, a.url, ...a.tags].some((f) => f.toLowerCase().includes(q))
    );
  }, [shownApps, q]);

  const filteredGroups = useMemo(() => {
    const matches = !q
      ? shownBookmarks
      : shownBookmarks.filter((b) =>
          [b.name, groupName(groups, b.group), b.url].some((f) => f.toLowerCase().includes(q))
        );
    return groupBookmarks(matches, groups);
  }, [shownBookmarks, q, groups]);

  // What Enter opens while searching (see topResultUrl), highlighted so the
  // keyboard shortcut isn't a guess (#274). A matching bang takes precedence.
  const topMatchId =
    q && !editing && !bangHit
      ? (filteredApps[0]?.id ?? filteredGroups[0]?.items[0]?.id ?? null)
      : null;

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
  const hasVisibleContent = shownApps.length > 0 || shownBookmarks.length > 0;
  const hasResults = filteredApps.length > 0 || filteredGroups.length > 0;

  function topResultUrl(): string | null {
    if (filteredApps.length > 0) return filteredApps[0].url;
    const firstGroup = filteredGroups[0];
    return firstGroup?.items[0]?.url ?? null;
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

  // Each widget as a node, or null when it has nothing to show right now —
  // see the renderer registry for the contract.
  const renderContext: WidgetRenderContext = {
    data,
    editing,
    q,
    search: { query, setQuery, inputRef: setSearchInput, onKeyDown: onSearchKeyDown },
    hasAnyContent,
    hasVisibleContent,
    favoriteApps,
    filteredApps,
    filteredGroups,
    topMatchId,
  };
  const blockFor = (widget: LayoutWidget): React.ReactNode =>
    WIDGET_RENDERERS[widget.type](widget, renderContext);


  // Why a widget's cell is empty right now — shown in its edit-mode placeholder.
  const emptyReason = (id: WidgetType): string =>
    widgetEmptyReason(id, { statusEnabled });

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
    announce(`${labelFor(liveWidgets[fromV])} moved to position ${toV + 1} of ${liveCells.length}`);
    const liveKeys = new Set(liveWidgets.map((w) => w.id));
    const nextVisible = reorder(liveWidgets, fromV, toV);
    let vi = 0;
    mutateSections(
      layout.sections.map((w) =>
        liveKeys.has(w.id) ? nextVisible[vi++] : w
      )
    );
  }

  // Put a tray widget on the page at a visible index (a drag from the tray,
  // #312): shown and placed in one change, so one undo step.
  function placeFromTray(id: string, toV: number) {
    const widget = layout.sections.find((w) => w.id === id);
    if (!widget) return;
    const rest = layout.sections.filter((w) => w.id !== id);
    const anchor = liveWidgets[toV];
    const last = liveWidgets[liveWidgets.length - 1];
    const at = anchor
      ? rest.findIndex((w) => w.id === anchor.id)
      : last
        ? rest.findIndex((w) => w.id === last.id) + 1
        : rest.length;
    rest.splice(at, 0, { ...widget, hidden: false });
    announce(`${labelFor(widget)} placed at position ${toV + 1} of ${liveWidgets.length + 1}`);
    mutateSections(rest);
    select(id);
    landingSeq.current += 1;
    setLanded({ id, seq: landingSeq.current });
  }

  // While a card is dragged the grid shows the result (#312): the order a
  // drop would leave, with the dragged card (or the tray widget on its way
  // in) as an invisible placeholder in its slot.
  let displayCells = liveCells;
  if (cardDrag && cardDrag.to !== null) {
    if (cardDrag.from !== null) {
      displayCells = reorder(liveCells, cardDrag.from, cardDrag.to);
    } else {
      const incoming = cells.find((c) => c.widget.id === cardDrag.id);
      if (incoming?.node)
        displayCells = [
          ...liveCells.slice(0, cardDrag.to),
          { widget: { ...incoming.widget, hidden: false }, node: incoming.node },
          ...liveCells.slice(cardDrag.to),
        ];
    }
  }
  const displayWidgets = displayCells.map(({ widget }) => widget);
  const draggedCell = cardDrag ? cells.find((c) => c.widget.id === cardDrag.id) : undefined;
  // The other cards glide to their new places as the preview changes
  // (FLIP), measured in page coordinates so auto-scroll isn't mistaken for
  // movement.
  const flipRects = useRef(new Map<string, { x: number; y: number }>());
  const flipKey = cardDrag ? `${cardDrag.id}:${cardDrag.to}` : "";
  const flipPrevKey = useRef("");
  useLayoutEffect(() => {
    // Only between two previews of one drag: the positions from before it
    // started may be from long ago.
    const animate = flipKey !== "" && flipPrevKey.current.split(":")[0] === flipKey.split(":")[0];
    flipPrevKey.current = flipKey;
    const grid = gridRef.current;
    if (!grid) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, { x: number; y: number }>();
    for (const el of grid.querySelectorAll<HTMLElement>(":scope > [data-widget-id]")) {
      const id = el.dataset.widgetId!;
      const r = el.getBoundingClientRect();
      const at = { x: r.left + window.scrollX, y: r.top + window.scrollY };
      next.set(id, at);
      const prev = flipRects.current.get(id);
      if (!animate || reduce || !prev || id === cardDrag?.id) continue;
      const dx = prev.x - at.x;
      const dy = prev.y - at.y;
      if (dx || dy)
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
          duration: 180,
          easing: "ease-out",
        });
    }
    flipRects.current = next;
    // Only when the preview's order changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipKey]);

  // The widget settings panel (#303): which widget's content is open beside
  // the page. A save refreshes the page's data so the card shows it.
  const router = useRouter();
  const [panelId, setPanelId] = useState<string | null>(null);
  const configure = (id: string) => {
    setPanelId(id);
    select(id);
  };
  // Settings → Widgets links here with ?configure=<id> (edit in place).
  useEffect(() => {
    if (!editing) return;
    const id = new URLSearchParams(window.location.search).get("configure");
    // A one-time read of the address on entering edit mode.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id && layout.sections.some((w) => w.id === id)) setPanelId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const panelWidget = panelId ? layout.sections.find((w) => w.id === panelId) : undefined;

  // The add-widget palette (#303): create the widget, place it after the
  // selected card (or at the end), select it and open its settings.
  async function addWidget(type: WidgetType): Promise<string | null> {
    let created;
    try {
      created = await createWidget(type);
    } catch (e) {
      return e instanceof Error ? e.message : "Couldn't add the widget";
    }
    const row: LayoutWidget = { id: created.id, type, span: widgetDef(type).span, hidden: false };
    mutateSections((sections) => {
      const after = selectedId ? sections.findIndex((w) => w.id === selectedId) : -1;
      const next = [...sections];
      next.splice(after >= 0 ? after + 1 : next.length, 0, row);
      return next;
    });
    announce(`${widgetDef(type).label} added`);
    configure(created.id);
    router.refresh();
    return null;
  }

  // The editor's live region (#313): moves, resizes and selection, said out
  // loud. A repeat of the same words still re-announces (the key changes).
  const [announcement, setAnnouncement] = useState({ text: "", n: 0 });
  const announce = (text: string) => setAnnouncement((a) => ({ text, n: a.n + 1 }));
  function selectCard(id: string) {
    if (id !== selectedId) announce(`${labelFor(layout.sections.find((w) => w.id === id)!)} selected`);
    select(id);
  }
  // A click anywhere but a card, the editor bar or a dialog deselects.
  useEffect(() => {
    if (!editing || !selectedId) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-widget-id], [data-editor-keep], [role='alertdialog']")) return;
      select(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [editing, selectedId, select]);

  // Show and Hide move a widget somewhere else on the page (#315): a shown
  // one goes back to its place in the grid, often far above the tray, and a
  // hidden one into the tray. Scroll to where it landed, outline it for a
  // moment and move focus there, rather than leave focus on a button that
  // just went away. A widget shown while still empty stays in the tray.
  // `seq` makes a repeat on the same widget a new landing.
  const landingSeq = useRef(0);
  const [landed, setLanded] = useState<{ id: string; seq: number } | null>(null);
  function showOrHide(id: string) {
    // A shown widget comes back selected, ready to place; a hidden one
    // leaves the selection.
    const wasHidden = layout.sections.find((w) => w.id === id)?.hidden;
    select(wasHidden ? id : null);
    toggleWidgetHidden(id);
    landingSeq.current += 1;
    setLanded({ id, seq: landingSeq.current });
  }
  useEffect(() => {
    if (!landed) return;
    const selector = `[data-widget-id="${CSS.escape(landed.id)}"]`;
    const target =
      gridRef.current?.querySelector<HTMLElement>(selector) ??
      trayRef.current?.querySelector<HTMLElement>(selector);
    if (target) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
      target.focus({ preventScroll: true });
    }
    const timer = window.setTimeout(() => setLanded(null), 1600);
    return () => window.clearTimeout(timer);
  }, [landed]);

  return (
    <UndoGestureContext.Provider value={gesture}>
      {/* The cards' content is inert while editing (#313), the greeting's
          heading with it, so the editor names the page itself. */}
      {editing && <h1 className="sr-only">Editing the layout</h1>}
      {/* Vertical layout (row-gap, per-cell row-span and margins) is driven by
          useGridLayout, not this class — the gap-y here is only a pre-hydration
          fallback. Sparse (non-dense) flow keeps cards in the order they're
          placed while still packing them up their columns, so the arrangement is
          deterministic and the editor previews exactly what ships. */}
      <div
        ref={gridRef}
        className="grid grid-cols-1 gap-x-8 gap-y-8 lg:grid-cols-24 lg:items-start"
      >
        {displayCells.map(({ widget, node }, vIndex) => {
          const cellClass = `${COL_SPAN[widget.span]} ${widgetDef(widget.type).align ?? ""}`;
          // An explicit height sizes the cell exactly: content widgets scroll
          // their overflow, the others center their content (so a sized greeting
          // sits centered beside the header card, restoring the classic header).
          // Scrolling widgets keep their height at every size — they can't clip.
          // The centering ones take it on lg+ only, like spans: below lg cells
          // stack full-width, contents grow taller (the header card's rows
          // stack), and a height tuned against the desktop row would silently
          // crop them (#105) — auto height is what a phone wants there.
          const scrolls = SIZED_WIDGET_TYPES.includes(widget.type);
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
              label={labelFor(widget)}
              index={vIndex}
              count={liveCells.length}
              cellClass={cellClass}
              node={node}
              effectiveCards={
                CARD_WIDGET_TYPES.includes(widget.type)
                  ? cardsFor(widget)
                  : undefined
              }
              fillTo={fillSpan(displayWidgets, vIndex)}
              titled={TITLED_WIDGET_TYPES.includes(widget.type)}
              previewStyle={heightStyle}
              previewClass={heightClass}
              onMove={moveVisible}
              onSpan={setWidgetSpan}
              onCards={setWidgetCards}
              onHeight={setWidgetHeight}
              onSpace={setWidgetSpace}
              onToggleHidden={showOrHide}
              onToggleLabel={toggleWidgetLabel}
              onConfigure={configure}
              landed={landed?.id === widget.id}
              selected={selectedId === widget.id}
              onSelect={selectCard}
              onAnnounce={announce}
              onGrab={(e) => pointer.begin(e, widget.id, vIndex)}
              clickEndsDrag={pointer.clickEndsDrag}
              placeholder={cardDrag?.id === widget.id}
              moving={cardDrag !== null}
            />
          );
        })}
      </div>

      {/* Widgets the live page doesn't render, kept discoverable while editing:
          hidden ones can be shown (then placed in the grid above), empty ones
          say what would give them content. */}
      {editing && trayCells.length > 0 && (
        <div
          ref={trayRef}
          className={`rounded-2xl border border-dashed p-4 transition-colors ${
            cardDrag?.overTray && cardDrag.from !== null ? "border-violet-400 bg-violet-400/10" : "border-fg/15"
          }`}
        >
          <p className="text-xs font-medium text-ink-70">
            {cardDrag && cardDrag.from !== null ? "Drop here to hide it" : "Not on the live page"}
          </p>
          <p className="mt-0.5 max-w-prose text-xs text-ink-55">
            These widgets don&apos;t render for visitors right now — hidden ones
            by choice, empty ones until they have something to show. The grid
            above packs exactly like the live page. Show a hidden widget, or
            drag it into place.
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-2">
            {trayCells.map(({ widget, node }) => {
              const label = labelFor(widget);
              // A hidden widget with content can be dragged onto the page.
              const draggable = widget.hidden && node !== null;
              return (
                <div
                  key={widget.id}
                  data-widget-id={widget.id}
                  tabIndex={-1}
                  onPointerDown={draggable ? (e) => pointer.begin(e, widget.id, null) : undefined}
                  onContextMenu={draggable ? (e) => e.preventDefault() : undefined}
                  className={`flex max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-fg/5 px-2.5 py-1.5 text-xs text-ink-60 outline-none transition-colors select-none sm:max-w-md ${
                    landed?.id === widget.id ? "border-violet-400 ring-2 ring-violet-400/60" : "border-fg/10"
                  } ${draggable ? "cursor-grab" : ""} ${cardDrag?.id === widget.id ? "opacity-40" : ""}`}
                >
                  <span className="font-medium">{label}</span>
                  <span className="rounded bg-fg/10 px-1.5 py-0.5 text-[10px] tracking-wide text-ink-60 uppercase">
                    {widget.hidden ? "Hidden" : "Empty"}
                  </span>
                  <span className="ml-auto flex gap-1">
                    <button
                      type="button"
                      onClick={() => configure(widget.id)}
                      aria-label={`Configure ${label}`}
                      className="rounded-md border border-fg/10 px-2 py-0.5 text-ink-70 transition-colors hover:bg-fg/10 hover:text-fg"
                    >
                      Configure
                    </button>
                    <button
                      type="button"
                      onClick={() => showOrHide(widget.id)}
                      aria-label={`${widget.hidden ? "Show" : "Hide"} ${label}`}
                      className="rounded-md border border-fg/10 px-2 py-0.5 text-ink-70 transition-colors hover:bg-fg/10 hover:text-fg"
                    >
                      {widget.hidden ? "Show" : "Hide"}
                    </button>
                  </span>
                  {/* An empty widget that's set to show appears once it has
                      content; say so, and what would give it some. Wraps
                      rather than truncating, so the hint stays readable. */}
                  {!widget.hidden && (
                    <span className="basis-full text-ink-55">
                      Shown when it has content. {emptyReason(widget.type)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editing && panelWidget && (
        <WidgetPanel
          // A fresh panel per widget, so another widget's editor never shows
          // under this one's name while it loads.
          key={panelWidget.id}
          id={panelWidget.id}
          label={labelFor(panelWidget)}
          onClose={() => {
            setPanelId(null);
            gridRef.current
              ?.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(panelWidget.id)}"]`)
              ?.focus({ preventScroll: true });
          }}
          onSaved={() => router.refresh()}
        />
      )}

      {cardDrag && draggedCell && (
        <DragGhost drag={cardDrag} label={labelFor(draggedCell.widget)} node={draggedCell.node} />
      )}

      {!editing && hasVisibleContent && !hasResults && parsedBang && (
        <p className="text-ink-50">
          {bangHit ? (
            <>
              <span className="text-ink-40">↵</span>{" "}
              {bangHit.term
                ? `Search ${bangHit.label} for “${bangHit.term}”`
                : `Open ${bangHit.label}`}
            </>
          ) : (
            <span className="text-ink-40">
              No bang “!{parsedBang.key}”. Press Enter to search the web.
            </span>
          )}
        </p>
      )}

      {!editing && hasVisibleContent && !hasResults && !parsedBang && (
        <p className="text-ink-40">
          No matches for “{query}”.{" "}
          {buildSearchUrl(search, query) && (
            <button
              type="button"
              onClick={webSearch}
              className="text-ink-60 underline transition-colors hover:text-ink-90"
            >
              Search {engineLabel(search)} for “{query}” →
            </button>
          )}
        </p>
      )}

      {!editing && !hasAnyContent && (
        <p className="text-ink-40">
          Nothing here yet.{" "}
          <Link href="/admin" className="underline hover:text-ink-70">
            Add your first app or bookmark
          </Link>
          .
        </p>
      )}

      {/* The edit toolbar is a fixed pill at the bottom of the viewport, so it
          floats over whatever sits at the end of the page — most painfully the
          tray, whose "Show" buttons are how a hidden widget (e.g. an RSS card)
          gets placed back. Reserve scroll room below the content while editing
          so the tray always clears the pill. Taller on small screens, where the
          pill wraps to more rows. */}
      {editing && <div aria-hidden className="h-40 sm:h-28" />}

      {/* What the cards' descriptions point at, and the live region (#313). */}
      {editing && (
        <div className="sr-only">
          <p id="layout-card-help">Press Enter to select this widget.</p>
          <p id="layout-selected-help">
            Selected. Arrow keys move it, Shift with the arrow keys resizes it,
            and Escape deselects it. Its controls follow.
          </p>
          <p aria-live="polite" key={announcement.n}>
            {announcement.text}
          </p>
        </div>
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
            canRedo={canRedo}
            onRedo={redoLast}
            onRevert={revertLayout}
            onReset={resetLayout}
            resetsToEmpty={!isHome}
            onDone={doneEditing}
            leading={
              <>
                {boards.length > 0 && <BoardsMenu boards={boards} currentId={boardId} />}
                <WidgetPalette onAdd={addWidget} className="shrink-0" />
              </>
            }
          />
        </ConfirmProvider>
      )}
    </UndoGestureContext.Provider>
  );
}
