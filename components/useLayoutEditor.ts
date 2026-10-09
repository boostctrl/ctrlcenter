"use client";

// The home-page layout editor's state (#290 split from Dashboard): the
// arrangement being edited, its debounced autosave, the undo stack, every
// per-widget edit, leaving edit mode, and the editing hotkeys. Dashboard
// renders; this owns what changes.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
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
import { saveSettingsPatch } from "./admin/settingsApi";

// What the layout editor edits and autosaves as one unit: the widget list plus
// the site-wide UI scale, the grid's vertical gap, and the page's top gap.
// Saved together because the settings API replaces the stored layout wholesale
// — a sections-only save would reset the page-level values.
export type EditableLayout = {
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

// Persist the whole layout; the settings API replaces it wholesale. Sections
// are stored by instance id (#297).
async function saveLayout(layout: EditableLayout, opts?: SaveOptions): Promise<void> {
  await saveSettingsPatch(
    { layout: { ...layout, sections: toSections(layout.sections) } },
    { fallback: "Failed to save layout", keepalive: opts?.keepalive }
  );
}

export function useLayoutEditor({
  initial,
  editing,
  setEditing,
  gridRef,
}: {
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
  }, [gridRef, layout.topGap]);

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
    // The stock arrangement over the stock instances; any other instance
    // (a second notes card, say) goes back to the tray.
    mutateLayout({
      sections: resolveLayout(
        DEFAULT_SECTIONS,
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
  }, [editing, undoLast, doneEditing, gridRef]);

  return {
    layout,
    canUndo,
    undoLast,
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
