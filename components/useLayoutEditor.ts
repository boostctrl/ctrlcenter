"use client";

// The home-page layout editor's state (#290 split from Dashboard): the
// arrangement being edited, its debounced autosave, the undo stack, every
// per-widget edit, leaving edit mode, and the editing hotkeys. Dashboard
// renders; this owns what changes. Undo and redo group by gesture
// (useUndoHistory, #314).
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import {
  GRID_COLUMNS,
  DEFAULT_UI_SCALE,
  DEFAULT_GRID_GAP,
  DEFAULT_TOP_GAP,
  DEFAULT_SECTIONS,
  boardLayoutPatch,
  resolveLayout,
  smallScreenTopGap,
  toSections,
  type LayoutWidget,
  type SpaceSide,
} from "@/lib/layout";
import { useAutosave, type SaveOptions } from "./admin/useAutosave";
import { saveBoardLayout } from "./admin/settingsApi";
import { useUndoHistory } from "./useUndoHistory";

// What the layout editor edits and autosaves as one unit: the board's widget
// list plus the site-wide UI scale, the grid's vertical gap, and the page's
// top gap (one undo stack and one save for everything its toolbar touches).
export type EditableLayout = {
  sections: LayoutWidget[];
  scale: number;
  gap: number;
  topGap: number;
};

// Persist the board's rows (stored by instance id, #297) to the board's
// layout endpoint (#298), with the page-level values this editor changed
// since it loaded (#396) — an unchanged scale isn't written back over one
// another board's editor just saved.
async function saveLayout(
  boardId: string,
  loaded: EditableLayout,
  layout: EditableLayout,
  opts?: SaveOptions
): Promise<void> {
  const patch = boardLayoutPatch(loaded, layout);
  await saveBoardLayout(
    boardId,
    { ...patch, sections: toSections(layout.sections) },
    { keepalive: opts?.keepalive }
  );
}

// Whether a key event comes from somewhere that types text.
function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === "TEXTAREA") return true;
  if (target.tagName !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return !["checkbox", "radio", "range", "button", "submit", "reset"].includes(type);
}

export function useLayoutEditor({
  boardId,
  isHome,
  initial,
  editing,
  setEditing,
  gridRef,
}: {
  // The board being edited (#298), and whether it's the first board, which
  // Reset returns to the stock arrangement (any other board resets to empty).
  boardId: string;
  isHome: boolean;
  initial: EditableLayout;
  editing: boolean;
  setEditing: (editing: boolean) => void;
  // The grid, for the top-gap variables on its <main> and the hotkeys'
  // open-popover check.
  gridRef: RefObject<HTMLDivElement | null>;
}) {
  const router = useRouter();
  // The rendered arrangement + UI scale. Client state so editor changes apply
  // instantly; the debounced autosave below persists them. `dirtyRef` gates
  // saving to changes actually made through the editor — the autosave hook
  // watches every state change and this component mounts for every visitor.
  const [layout, setLayout] = useState<EditableLayout>(initial);
  const dirtyRef = useRef(false);
  // What Revert restores: the layout as it was when edit mode was entered (the
  // last-saved value would trail the debounced autosave by a beat).
  const entryRef = useRef(layout);
  // Undo and redo. The stacks only grow through the editor's controls, so
  // clearing them when editing ends (see doneEditing — the mode's only exit)
  // is what keeps Ctrl+Z from reaching back into a finished session.
  const history = useUndoHistory<EditableLayout>();
  const { canUndo, canRedo } = history;
  useEffect(() => {
    if (editing) entryRef.current = layout;
    // Snapshot only when edit mode is entered — not again on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // During a pointer gesture (a resize drag, a held stepper) the autosave
  // sees the layout as it was when the gesture began, so it saves once the
  // gesture ends rather than partway through (#312).
  const [gestureStart, setGestureStart] = useState<EditableLayout | null>(null);
  // What the page loaded with: the page-level values go out only when they
  // differ from these (#396).
  const loadedRef = useRef(initial);
  const { status: saveStatus, error: saveError } = useAutosave(
    gestureStart ?? layout,
    async (value, opts) => {
      if (!dirtyRef.current) return;
      await saveLayout(boardId, loadedRef.current, value, opts);
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
  }, [gridRef, layout.topGap]);

  // The newest layout, updated as each change is made rather than when React
  // renders it: two changes in one frame (a corner drag's width and height,
  // pointer events landing before a render) must build on each other, not
  // both on the last render's layout. The hotkeys' and gestures' handlers,
  // which outlive a render, read it too.
  const latestRef = useRef(layout);
  type Update<T> = T | ((prev: T) => T);
  function mutateLayout(update: Update<EditableLayout>) {
    const prev = latestRef.current;
    const next = typeof update === "function" ? update(prev) : update;
    // A change that changes nothing (End on a card already 24 columns wide,
    // Revert with nothing to revert) is no undo step, and must not take the
    // redo stack with it (#400).
    if (next === prev || JSON.stringify(next) === JSON.stringify(prev)) return;
    history.record(prev);
    dirtyRef.current = true;
    latestRef.current = next;
    setLayout(next);
  }
  // Whether a pointer gesture is in progress: a resize drag or a held
  // stepper (bracketed by `gesture` below), or a card being moved
  // (usePointerReorder, which is handed this ref). The editor's Escape
  // stands down while one is — the gesture's own Escape cancels it, and
  // leaving edit mode under a captured pointer would unmount the handle
  // before its pointerup, so the gesture would never end (#400). So do
  // Undo and Redo, whoever calls them: an undo mid-gesture would close the
  // history's open step, so the rest of the drag would land in a new one
  // and one resize would take two to take back (#424). The guard lives in
  // the two functions rather than in the hotkey handler because the
  // toolbar's buttons call them too, and a second finger on a touch screen
  // can reach those mid-drag (#432).
  const dragging = useRef(false);
  const { undo, redo } = history;
  const undoLast = useCallback(() => {
    if (dragging.current) return;
    const prev = undo(latestRef.current);
    if (!prev) return;
    dirtyRef.current = true;
    latestRef.current = prev;
    setLayout(prev);
  }, [undo]);
  const redoLast = useCallback(() => {
    if (dragging.current) return;
    const next = redo(latestRef.current);
    if (!next) return;
    dirtyRef.current = true;
    latestRef.current = next;
    setLayout(next);
  }, [redo]);
  // Revert and Reset are their own undo steps, so Ctrl+Z can take either
  // back.
  function revertLayout() {
    mutateLayout(entryRef.current);
  }
  function resetLayout() {
    // The home board: the stock arrangement over the stock instances, with
    // any other instance (a second notes card, say) back in the tray. Any
    // other board: empty, everything in the tray.
    mutateLayout((prev) => ({
      sections: resolveLayout(
        isHome ? DEFAULT_SECTIONS : [],
        prev.sections.map(({ id, type }) => ({ id, type }))
      ),
      scale: DEFAULT_UI_SCALE,
      gap: DEFAULT_GRID_GAP,
      topGap: DEFAULT_TOP_GAP,
    }));
  }
  const mutateSections = (update: Update<LayoutWidget[]>) =>
    mutateLayout((prev) => ({
      ...prev,
      sections: typeof update === "function" ? update(prev.sections) : update,
    }));
  // Per-widget edits match on the instance id, so two widgets of a type stay
  // independent.
  const editWidget = (key: string, edit: (w: LayoutWidget) => LayoutWidget) =>
    mutateSections((sections) => sections.map((w) => (w.id === key ? edit(w) : w)));
  // An optional key set, or dropped when undefined so the stored entry stays
  // clean.
  function withOptional<K extends "cards" | "height">(w: LayoutWidget, key: K, value: LayoutWidget[K]) {
    const rest = { ...w };
    if (value !== undefined) rest[key] = value;
    else delete rest[key];
    return rest;
  }
  const setWidgetSpan = (key: string, span: number) =>
    editWidget(key, (w) => ({ ...w, span: Math.min(GRID_COLUMNS, Math.max(1, span)) }));
  // Cards per row for the card-grid widgets; undefined returns to auto.
  const setWidgetCards = (key: string, cards: number | undefined) =>
    editWidget(key, (w) => withOptional(w, "cards", cards));
  // Explicit height (px) for any widget; undefined clears it back to auto.
  const setWidgetHeight = (key: string, height: number | undefined) =>
    editWidget(key, (w) => withOptional(w, "height", height));
  // Extra space (px) on one side of a widget; undefined/0 clears that side. An
  // emptied `space` object is dropped so stored entries stay clean (like cards).
  const setWidgetSpace = (key: string, side: SpaceSide, value: number | undefined) =>
    editWidget(key, (w) => {
      const nextSpace = { ...(w.space ?? {}) };
      if (value) nextSpace[side] = value;
      else delete nextSpace[side];
      const rest = { ...w };
      if (Object.keys(nextSpace).length > 0) rest.space = nextSpace;
      else delete rest.space;
      return rest;
    });
  const setScale = (next: number) => mutateLayout((prev) => ({ ...prev, scale: next }));
  const setGap = (next: number) => mutateLayout((prev) => ({ ...prev, gap: next }));
  const setTopGap = (next: number) => mutateLayout((prev) => ({ ...prev, topGap: next }));
  const toggleWidgetHidden = (key: string) => editWidget(key, (w) => ({ ...w, hidden: !w.hidden }));
  // Toggle the section heading. Stored only when off (the key is dropped when
  // turning it back on) so entries stay clean, like `cards`.
  const toggleWidgetLabel = (key: string) =>
    editWidget(key, (w) => {
      if (!w.hideLabel) return { ...w, hideLabel: true };
      const rest = { ...w };
      delete rest.hideLabel;
      return rest;
    });
  const { beginGesture, endGesture, group } = history;
  const gesture = useMemo(
    () => ({
      begin: () => {
        beginGesture();
        dragging.current = true;
        setGestureStart(latestRef.current);
      },
      end: () => {
        endGesture(latestRef.current);
        dragging.current = false;
        setGestureStart(null);
      },
      group,
    }),
    [beginGesture, endGesture, group]
  );
  const clearHistory = history.clear;

  // The selected card (#313): only it shows its controls. Cleared on leaving
  // edit mode.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  // A widget deleted for good (#318): gone from the arrangement, from every
  // undo and redo step and from what Revert restores, so nothing can put back
  // a row naming it. Not an undo step itself, and not a change to save: the
  // delete already took its rows off every board.
  const { rewrite } = history;
  const forgetWidget = useCallback(
    (id: string) => {
      const without = (l: EditableLayout) => ({ ...l, sections: l.sections.filter((w) => w.id !== id) });
      const next = without(latestRef.current);
      latestRef.current = next;
      entryRef.current = without(entryRef.current);
      rewrite(without, next);
      setLayout(next);
      setSelectedId((s) => (s === id ? null : s));
    },
    [rewrite]
  );

  // A widget just created from the palette (#303), into the tray as a hidden
  // row — the mirror of forgetWidget: in the arrangement, in every undo and
  // redo step and in what Revert restores, and not an undo step itself. The
  // caller then records its placement, so Undo right after adding takes back
  // only that and leaves the widget in the tray, where it can be reached,
  // rather than making it vanish until a reload (#400). Not a change to save
  // either: a widget in none of a board's rows already resolves to a hidden
  // one.
  const adoptWidget = useCallback(
    (row: LayoutWidget) => {
      const withRow = (l: EditableLayout) =>
        l.sections.some((w) => w.id === row.id)
          ? l
          : { ...l, sections: [...l.sections, { ...row, hidden: true }] };
      const next = withRow(latestRef.current);
      latestRef.current = next;
      entryRef.current = withRow(entryRef.current);
      rewrite(withRow, next);
      setLayout(next);
    },
    [rewrite]
  );

  const doneEditing = useCallback(() => {
    setEditing(false);
    setSelectedId(null);
    clearHistory();
    // A gesture still open as edit mode ends (its handle unmounted under a
    // captured pointer) must not leave the autosave watching a frozen value
    // for the rest of the page session (#400).
    dragging.current = false;
    setGestureStart(null);
    // Drop a stale ?edit=1 (the deep link from admin Settings) so a reload
    // doesn't reopen the editor.
    if (window.location.search.includes("edit="))
      router.replace(window.location.pathname, { scroll: false });
  }, [setEditing, router, clearHistory]);

  // Editing hotkeys: Ctrl/Cmd+Z undoes the last layout change, and
  // Ctrl/Cmd+Shift+Z or Ctrl+Y redoes it — except in a text field, which
  // keeps its own undo, and not during a gesture (#424). Escape deselects
  // the selected card, and with none selected exits edit mode like Done —
  // unless a layered surface should eat it first (an open More popover, the
  // reset confirm dialog), whose own handlers close it.
  // Capture phase, so the open-popover check runs before those document-level
  // handlers have closed anything.
  useEffect(() => {
    if (!editing) return;
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y") && !inTextField(e.target)) {
        // Prevented even mid-gesture, when undoLast and redoLast stand
        // down themselves (#424, #432), so the browser's own undo doesn't
        // run instead.
        e.preventDefault();
        if (key === "z" && !e.shiftKey) undoLast();
        else redoLast();
        return;
      }
      if (e.key === "Escape") {
        // A drag's own Escape cancels it; both listeners are capture-phase
        // on window, so this one can't be stopped and has to stand down
        // itself (#400).
        if (dragging.current) return;
        // A layered surface closes first, on its own Escape: a card's More
        // menu, the widget settings panel, the add-widget palette, the boards
        // menu (#303).
        if (
          document.querySelector(
            "details[data-editor-more][open], [data-widget-panel], [data-widget-palette], [data-boards-menu]"
          )
        )
          return;
        if (document.querySelector('[role="alertdialog"]')) return;
        const selected = selectedRef.current;
        if (selected) {
          e.preventDefault();
          setSelectedId(null);
          // Back to the card, from its toolbar (which goes away).
          gridRef.current
            ?.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(selected)}"]`)
            ?.focus({ preventScroll: true });
          return;
        }
        doneEditing();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editing, undoLast, redoLast, doneEditing, gridRef]);

  return {
    layout,
    canUndo,
    canRedo,
    undoLast,
    redoLast,
    gesture,
    dragging,
    selectedId,
    select: setSelectedId,
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
    adoptWidget,
    forgetWidget,
    saveStatus,
    saveError,
  };
}
