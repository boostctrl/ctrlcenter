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

// Persist the board's rows (stored by instance id, #297) and the page-level
// values to the board's layout endpoint (#298).
async function saveLayout(boardId: string, layout: EditableLayout, opts?: SaveOptions): Promise<void> {
  await saveBoardLayout(
    boardId,
    { ...layout, sections: toSections(layout.sections) },
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

  const { status: saveStatus, error: saveError } = useAutosave(
    layout,
    async (value, opts) => {
      if (!dirtyRef.current) return;
      await saveLayout(boardId, value, opts);
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

  function mutateLayout(next: EditableLayout) {
    history.record(layout);
    dirtyRef.current = true;
    setLayout(next);
  }
  // The hotkeys' handlers outlive a render, so they read the layout here.
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  const { undo, redo } = history;
  const undoLast = useCallback(() => {
    const prev = undo(layoutRef.current);
    if (!prev) return;
    dirtyRef.current = true;
    setLayout(prev);
  }, [undo]);
  const redoLast = useCallback(() => {
    const next = redo(layoutRef.current);
    if (!next) return;
    dirtyRef.current = true;
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
    mutateLayout({
      sections: resolveLayout(
        isHome ? DEFAULT_SECTIONS : [],
        layout.sections.map(({ id, type }) => ({ id, type }))
      ),
      scale: DEFAULT_UI_SCALE,
      gap: DEFAULT_GRID_GAP,
      topGap: DEFAULT_TOP_GAP,
    });
  }
  const mutateSections = (sections: LayoutWidget[]) =>
    mutateLayout({ ...layout, sections });
  // Per-widget edits match on the instance id, so two widgets of a type stay
  // independent.
  const setWidgetSpan = (key: string, span: number) =>
    mutateSections(
      layout.sections.map((w) =>
        w.id === key
          ? { ...w, span: Math.min(GRID_COLUMNS, Math.max(1, span)) }
          : w
      )
    );
  // Cards per row for the card-grid widgets; undefined returns to auto (the
  // key is dropped so the stored entry stays clean).
  const setWidgetCards = (key: string, cards: number | undefined) =>
    mutateSections(
      layout.sections.map((w) => {
        if (w.id !== key) return w;
        if (cards !== undefined) return { ...w, cards };
        const rest = { ...w };
        delete rest.cards;
        return rest;
      })
    );
  // Explicit height (px) for any widget; undefined clears it back to auto (the
  // key is dropped so the stored entry stays clean, like `cards`).
  const setWidgetHeight = (key: string, height: number | undefined) =>
    mutateSections(
      layout.sections.map((w) => {
        if (w.id !== key) return w;
        if (height !== undefined) return { ...w, height };
        const rest = { ...w };
        delete rest.height;
        return rest;
      })
    );
  // Extra space (px) on one side of a widget; undefined/0 clears that side. An
  // emptied `space` object is dropped so stored entries stay clean (like cards).
  const setWidgetSpace = (
    key: string,
    side: SpaceSide,
    value: number | undefined
  ) =>
    mutateSections(
      layout.sections.map((w) => {
        if (w.id !== key) return w;
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
  const toggleWidgetHidden = (key: string) =>
    mutateSections(
      layout.sections.map((w) =>
        w.id === key ? { ...w, hidden: !w.hidden } : w
      )
    );
  // Toggle the section heading. Stored only when off (the key is dropped when
  // turning it back on) so entries stay clean, like `cards`.
  const toggleWidgetLabel = (key: string) =>
    mutateSections(
      layout.sections.map((w) => {
        if (w.id !== key) return w;
        if (w.hideLabel) {
          const rest = { ...w };
          delete rest.hideLabel;
          return rest;
        }
        return { ...w, hideLabel: true };
      })
    );
  const { beginGesture, endGesture } = history;
  const gesture = useMemo(() => ({ begin: beginGesture, end: endGesture }), [beginGesture, endGesture]);
  const clearHistory = history.clear;
  const doneEditing = useCallback(() => {
    setEditing(false);
    clearHistory();
    // Drop a stale ?edit=1 (the deep link from admin Settings) so a reload
    // doesn't reopen the editor.
    if (window.location.search.includes("edit="))
      router.replace(window.location.pathname, { scroll: false });
  }, [setEditing, router, clearHistory]);

  // Editing hotkeys: Ctrl/Cmd+Z undoes the last layout change, and
  // Ctrl/Cmd+Shift+Z or Ctrl+Y redoes it — except in a text field, which
  // keeps its own undo. Escape exits
  // edit mode like Done — unless a layered surface should eat it first (an
  // open More popover, the reset confirm dialog), whose own handlers close it.
  // Capture phase, so the open-popover check runs before those document-level
  // handlers have closed anything.
  useEffect(() => {
    if (!editing) return;
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y") && !inTextField(e.target)) {
        e.preventDefault();
        if (key === "z" && !e.shiftKey) undoLast();
        else redoLast();
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
  }, [editing, undoLast, redoLast, doneEditing, gridRef]);

  return {
    layout,
    canUndo,
    canRedo,
    undoLast,
    redoLast,
    gesture,
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
  };
}
