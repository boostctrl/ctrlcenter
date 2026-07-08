"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  GRID_COLUMNS,
  MAX_CARD_COLUMNS,
  MIN_WIDGET_HEIGHT,
  MAX_WIDGET_HEIGHT,
  DEFAULT_WIDGET_HEIGHT,
  WIDGET_HEIGHT_STEP,
  MAX_WIDGET_SPACE,
  WIDGET_SPACE_STEP,
  MIN_GRID_GAP,
  MAX_GRID_GAP,
  GRID_GAP_STEP,
  MIN_TOP_GAP,
  MAX_TOP_GAP,
  TOP_GAP_STEP,
  MIN_UI_SCALE,
  MAX_UI_SCALE,
  UI_SCALE_STEP,
  SPACE_SIDES,
  WIDGET_LABELS,
  type LayoutWidget,
  type LayoutWidgetId,
  type SpaceSide,
} from "@/lib/layout";
import { MoveButtons } from "./admin/ui";
import { useConfirm } from "./admin/Confirm";
import { SaveStatus, type SaveState } from "./admin/useAutosave";
import { useDragResize } from "./useDragResize";

// Which edge of the hovered cell a drop would insert on, in flow order, and
// which axis that edge sits on ("x" = beside the cell, "y" = above/below it).
export type DropSide = "before" | "after";
export type DropAxis = "x" | "y";
export type DropTarget = { side: DropSide; axis: DropAxis };

// Native HTML5 drag reordering for the widget flow grid — the 2-D sibling of
// useReorder (components/admin/useReorder.ts). Reordering starts from the grip
// handle only (so the card's resize edges are free for useDragResize); the whole
// cell stays the drop target. Cells can sit side by side on lg+ screens, so the
// insertion side comes from the pointer's x position within the hovered cell
// there — except for cells spanning their whole row, where a drop can only land
// above or below, so the y axis decides (as it does for every cell below lg,
// where cells stack). Drag is mouse-only by design; MoveButtons in each frame
// are the keyboard/touch path.
export function useFlowReorder(onMove: (from: number, to: number) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [over, setOver] = useState<
    ({ index: number } & DropTarget) | null
  >(null);

  function reset() {
    setDragIndex(null);
    setOver(null);
  }

  // The grip: the drag source. draggable lives here, not on the cell, so a
  // pointer-down on a resize edge can't start a reorder.
  function gripHandlers(index: number) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = "move";
        setDragIndex(index);
      },
      onDragEnd: reset,
    };
  }

  // The cell: the drop target.
  function dropHandlers(index: number) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (dragIndex === null) return;
        e.preventDefault(); // required to allow dropping
        const rect = e.currentTarget.getBoundingClientRect();
        const grid = e.currentTarget.parentElement;
        const fullRow =
          grid !== null &&
          rect.width >= grid.getBoundingClientRect().width - 1;
        const sideBySide =
          window.matchMedia("(min-width: 1024px)").matches && !fullRow;
        const axis: DropAxis = sideBySide ? "x" : "y";
        const ratio =
          axis === "x"
            ? (e.clientX - rect.left) / rect.width
            : (e.clientY - rect.top) / rect.height;
        const side: DropSide = ratio > 0.5 ? "after" : "before";
        if (over?.index !== index || over.side !== side || over.axis !== axis)
          setOver({ index, side, axis });
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (dragIndex === null || over === null) {
          reset();
          return;
        }
        // Insert at the hovered cell's edge, accounting for the dragged item
        // leaving its old slot when it comes from earlier in the list.
        let to = over.index + (over.side === "after" ? 1 : 0);
        if (dragIndex < to) to -= 1;
        if (to !== dragIndex) onMove(dragIndex, to);
        reset();
      },
    };
  }

  return { gripHandlers, dropHandlers, dragIndex, over };
}

// The insertion indicator: a vertical accent bar beside the hovered cell when
// the drop would land beside it (x axis), a horizontal one above/below it when
// the drop lands in the flow (y axis — stacked cells and full-row cells).
// Complete static class strings so Tailwind's extractor keeps every variant.
const DROP_BAR: Record<`${DropSide}:${DropAxis}`, string> = {
  "before:y": "absolute right-0 left-0 -top-2 h-1 rounded-full bg-violet-400",
  "after:y": "absolute right-0 left-0 -bottom-2 h-1 rounded-full bg-violet-400",
  "before:x": "absolute top-0 bottom-0 -left-2 w-1 rounded-full bg-violet-400",
  "after:x": "absolute top-0 bottom-0 -right-2 w-1 rounded-full bg-violet-400",
};

const stepBtn =
  "px-2 py-1 text-fg/60 transition-colors hover:bg-fg/10 hover:text-fg disabled:pointer-events-none disabled:opacity-30";

// A −/value/+ stepper group, optionally with a trailing button (e.g. "Auto").
function StepGroup({
  display,
  title,
  decLabel,
  incLabel,
  onDec,
  onInc,
  canDec,
  canInc,
  extra,
  className = "",
}: {
  display: ReactNode;
  title?: string;
  decLabel: string;
  incLabel: string;
  onDec: () => void;
  onInc: () => void;
  canDec: boolean;
  canInc: boolean;
  extra?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center overflow-hidden rounded-lg border border-fg/10 ${className}`}
      title={title}
    >
      <button
        type="button"
        aria-label={decLabel}
        disabled={!canDec}
        onClick={onDec}
        className={stepBtn}
      >
        −
      </button>
      <span className="px-1 text-fg/50 tabular-nums">{display}</span>
      <button
        type="button"
        aria-label={incLabel}
        disabled={!canInc}
        onClick={onInc}
        className={stepBtn}
      >
        +
      </button>
      {extra}
    </div>
  );
}

// Arrow + accessible name for each spacing side, in SPACE_SIDES order.
const SIDE_META: Record<SpaceSide, { arrow: string; name: string }> = {
  top: { arrow: "↑", name: "above" },
  right: { arrow: "→", name: "right of" },
  bottom: { arrow: "↓", name: "below" },
  left: { arrow: "←", name: "left of" },
};

// The per-card "More" popover: a native <details> for the disclosure basics,
// plus the app's standard popover manners (see FloatingNav) — close on outside
// click and Escape. Without them the menu only closes by re-clicking its own
// summary, so several can pile up and an open one overlaps the card beside it
// (#100).
function MoreMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => {
      if (ref.current) ref.current.open = false;
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <details
      ref={ref}
      className="relative"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center rounded-lg border border-fg/10 px-2 py-1 text-fg/60 transition-colors hover:bg-fg/10 hover:text-fg [&::-webkit-details-marker]:hidden">
        More
      </summary>
      <div className="absolute top-full right-0 z-10 mt-1 flex w-56 flex-col gap-3 rounded-xl border border-fg/10 bg-[var(--background)] p-3 shadow-lg">
        {children}
      </div>
    </details>
  );
}

// Edit-mode chrome around one widget cell: a dashed frame with the widget's
// label, a title-row drag zone that reorders, MoveButtons, the common size
// controls (span + Fill, height), a "More" popover with per-side spacing /
// cards-per-row / label toggle, and a Hide button. Right- and bottom-edge
// handles resize the width and height by dragging. Only widgets the live page
// renders get a frame — hidden and empty ones live in the Dashboard's tray —
// so the edit grid packs exactly like the live page (#98).
export function WidgetFrame({
  widget,
  index,
  count,
  cellClass,
  node,
  effectiveCards,
  fillTo,
  titled,
  previewStyle,
  previewClass,
  onMove,
  onSpan,
  onCards,
  onHeight,
  onSpace,
  onToggleHidden,
  onToggleLabel,
  gripHandlers,
  dropHandlers,
  dragging,
  drop,
}: {
  widget: LayoutWidget;
  index: number;
  count: number;
  cellClass: string;
  node: ReactNode;
  // Cards per row the widget renders right now (override, else span-derived).
  // Only the card-grid widgets pass one; it gates the stepper and anchors the
  // first −/+ step so adjusting from "Auto" starts at what's on screen.
  effectiveCards?: number;
  // The span that would fill this widget to the end of its row; the Fill button
  // shows only when that's wider than the current span (i.e. there's dead space).
  fillTo: number;
  // Whether the widget has a section heading that can be toggled off.
  titled: boolean;
  // Applied to the live preview so the set height shows while editing.
  previewStyle?: React.CSSProperties;
  previewClass: string;
  onMove: (from: number, to: number) => void;
  onSpan: (id: LayoutWidgetId, span: number) => void;
  onCards: (id: LayoutWidgetId, cards: number | undefined) => void;
  onHeight: (id: LayoutWidgetId, height: number | undefined) => void;
  onSpace: (id: LayoutWidgetId, side: SpaceSide, value: number | undefined) => void;
  onToggleHidden: (id: LayoutWidgetId) => void;
  onToggleLabel: (id: LayoutWidgetId) => void;
  gripHandlers: React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
  dropHandlers: React.HTMLAttributes<HTMLDivElement>;
  dragging: boolean;
  drop: DropTarget | null;
}) {
  const label = WIDGET_LABELS[widget.id];
  const { frameRef, previewRef, drag, widthHandle, heightHandle } = useDragResize(
    {
      span: widget.span,
      height: widget.height,
      onSpan: (span) => onSpan(widget.id, span),
      onHeight: (height) => onHeight(widget.id, height),
    }
  );
  const space = widget.space ?? {};
  // Narrow cells can't fit the whole control strip beside the label without
  // wrapping over the preview, so the height stepper moves into More there.
  const narrow = widget.span < 8;
  const heightStepper = (
    <StepGroup
      title="Card height — or drag the bottom edge; taller than the content adds breathing room, content widgets scroll"
      display={widget.height !== undefined ? `${widget.height}px` : "Auto"}
      decLabel={`Shorter ${label}`}
      incLabel={`Taller ${label}`}
      onDec={() =>
        onHeight(
          widget.id,
          widget.height === undefined
            ? DEFAULT_WIDGET_HEIGHT
            : Math.max(MIN_WIDGET_HEIGHT, widget.height - WIDGET_HEIGHT_STEP)
        )
      }
      onInc={() =>
        onHeight(
          widget.id,
          widget.height === undefined
            ? DEFAULT_WIDGET_HEIGHT
            : Math.min(MAX_WIDGET_HEIGHT, widget.height + WIDGET_HEIGHT_STEP)
        )
      }
      canDec={widget.height === undefined || widget.height > MIN_WIDGET_HEIGHT}
      canInc={widget.height === undefined || widget.height < MAX_WIDGET_HEIGHT}
      extra={
        widget.height !== undefined && (
          <button
            type="button"
            aria-label={`Automatic height for ${label}`}
            onClick={() => onHeight(widget.id, undefined)}
            className={`${stepBtn} border-l border-fg/10 text-[10px] tracking-wide uppercase`}
          >
            Auto
          </button>
        )
      }
    />
  );
  return (
    <div
      ref={frameRef}
      {...dropHandlers}
      data-space-top={space.top || undefined}
      data-space-right={space.right || undefined}
      data-space-bottom={space.bottom || undefined}
      data-space-left={space.left || undefined}
      className={`relative flex flex-col gap-2 rounded-2xl p-2 outline-2 outline-dashed outline-fg/15 transition-opacity select-none ${
        dragging ? "opacity-40" : ""
      } ${cellClass}`}
    >
      {drop && (
        <span className={DROP_BAR[`${drop.side}:${drop.axis}`]} aria-hidden />
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg/60">
        {/* The whole label strip — grip, label, and the empty run before the
            controls — is the drag source, not just the 16px grip: grabbing the
            card's title is the natural first gesture, and the resize handles
            live on the cell edges so a wide top drag zone can't collide with
            them (#99). The frame is select-none so a drag that starts anywhere
            on the card can't smear a text selection instead. */}
        <span
          {...gripHandlers}
          className="flex min-w-0 flex-1 cursor-grab items-center gap-x-2 active:cursor-grabbing"
          title="Drag to move"
        >
          <span className="hidden text-fg/50 sm:inline" aria-hidden>
            ⠿
          </span>
          <span className="font-medium">{label}</span>
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <MoveButtons
            index={index}
            count={count}
            label={label}
            onMove={onMove}
            flow
          />
          <StepGroup
            title={`Column width: ${widget.span} of ${GRID_COLUMNS} columns — drag the right edge to resize. Widths apply on large screens.`}
            display={`${widget.span}/${GRID_COLUMNS}`}
            decLabel={`Narrow ${label}`}
            incLabel={`Widen ${label}`}
            onDec={() => onSpan(widget.id, widget.span - 1)}
            onInc={() => onSpan(widget.id, widget.span + 1)}
            canDec={widget.span > 1}
            canInc={widget.span < GRID_COLUMNS}
            className="max-lg:opacity-60"
          />
          {/* Parked during a resize drag: the span changes every step, so the
              button popping in/out would reflow the strip mid-gesture. */}
          {!drag && fillTo > widget.span && (
            <button
              type="button"
              onClick={() => onSpan(widget.id, fillTo)}
              title={`Widen ${label} to fill the empty space in its row`}
              className="rounded-lg border border-fg/10 px-2 py-1 text-fg/60 transition-colors hover:bg-fg/10 hover:text-fg"
            >
              Fill
            </button>
          )}
          {!narrow && heightStepper}
          <MoreMenu>
              {narrow && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] tracking-wide text-fg/40 uppercase">
                    Height
                  </span>
                  {heightStepper}
                </div>
              )}
            <div className="flex flex-col gap-1.5">
                <span className="text-[10px] tracking-wide text-fg/40 uppercase">
                  Space around card
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {SPACE_SIDES.map((side) => (
                    <StepGroup
                      key={side}
                      title={`Space ${SIDE_META[side].name} ${label}`}
                      display={
                        <span className="flex items-center gap-1">
                          <span aria-hidden>{SIDE_META[side].arrow}</span>
                          {space[side] ?? 0}
                        </span>
                      }
                      decLabel={`Less space ${SIDE_META[side].name} ${label}`}
                      incLabel={`More space ${SIDE_META[side].name} ${label}`}
                      onDec={() => {
                        const cur = space[side] ?? 0;
                        onSpace(
                          widget.id,
                          side,
                          cur > WIDGET_SPACE_STEP ? cur - WIDGET_SPACE_STEP : undefined
                        );
                      }}
                      onInc={() =>
                        onSpace(
                          widget.id,
                          side,
                          Math.min(
                            MAX_WIDGET_SPACE,
                            (space[side] ?? 0) + WIDGET_SPACE_STEP
                          )
                        )
                      }
                      canDec={!!space[side]}
                      canInc={(space[side] ?? 0) < MAX_WIDGET_SPACE}
                    />
                  ))}
                </div>
              </div>
              {effectiveCards !== undefined && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] tracking-wide text-fg/40 uppercase">
                    Cards / row
                  </span>
                  <StepGroup
                    display={widget.cards !== undefined ? `${widget.cards}×` : "Auto"}
                    decLabel={`Fewer cards per row in ${label}`}
                    incLabel={`More cards per row in ${label}`}
                    onDec={() => onCards(widget.id, effectiveCards - 1)}
                    onInc={() => onCards(widget.id, effectiveCards + 1)}
                    canDec={effectiveCards > 1}
                    canInc={effectiveCards < MAX_CARD_COLUMNS}
                    extra={
                      widget.cards !== undefined && (
                        <button
                          type="button"
                          aria-label={`Automatic cards per row in ${label}`}
                          onClick={() => onCards(widget.id, undefined)}
                          className={`${stepBtn} border-l border-fg/10 text-[10px] tracking-wide uppercase`}
                        >
                          Auto
                        </button>
                      )
                    }
                  />
                </div>
              )}
              {titled && (
                <button
                  type="button"
                  aria-pressed={!widget.hideLabel}
                  onClick={() => onToggleLabel(widget.id)}
                  className="rounded-lg border border-fg/10 px-2 py-1 text-fg/60 transition-colors hover:bg-fg/10 hover:text-fg"
                >
                  {widget.hideLabel ? "Show heading" : "Hide heading"}
                </button>
              )}
          </MoreMenu>
          <button
            type="button"
            onClick={() => onToggleHidden(widget.id)}
            title={`Hide ${label} from the page (it moves to the tray below)`}
            className="rounded-lg border border-fg/10 px-2 py-1 text-fg/60 transition-colors hover:bg-fg/10 hover:text-fg"
          >
            Hide
          </button>
        </div>
      </div>
      {/* Inert while editing so a drag can't trigger the widget's links; the
          preview carries the set height so sizing shows live. */}
      <div
        ref={previewRef}
        className={`pointer-events-none ${previewClass}`}
        style={previewStyle}
      >
        {node}
      </div>
      {/* Drag-to-resize edges: right = width (lg+, where spans apply), bottom =
          height. A live badge shows the value while dragging. */}
      <span
        {...widthHandle}
        role="slider"
        aria-label={`Drag to set ${label} width`}
        aria-valuenow={widget.span}
        aria-valuemin={1}
        aria-valuemax={GRID_COLUMNS}
        className="absolute top-1/2 right-0 hidden h-12 w-2 -translate-y-1/2 cursor-col-resize touch-none rounded-full bg-fg/10 transition-colors hover:bg-violet-400/70 lg:block"
      />
      <span
        {...heightHandle}
        role="slider"
        aria-label={`Drag to set ${label} height`}
        aria-valuenow={widget.height ?? 0}
        aria-valuemin={MIN_WIDGET_HEIGHT}
        aria-valuemax={MAX_WIDGET_HEIGHT}
        className="absolute bottom-0 left-1/2 h-2 w-12 -translate-x-1/2 cursor-row-resize touch-none rounded-full bg-fg/10 transition-colors hover:bg-violet-400/70"
      />
      {drag && (
        <span
          className={`pointer-events-none absolute z-20 rounded-md bg-violet-500 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums ${
            drag.kind === "width"
              ? "top-1/2 right-3 -translate-y-1/2"
              : "bottom-3 left-1/2 -translate-x-1/2"
          }`}
        >
          {drag.kind === "width" ? `${drag.value}/${GRID_COLUMNS}` : `${drag.value}px`}
        </span>
      )}
    </div>
  );
}

// One labeled −/value/+ group in the edit toolbar. The tiny always-visible
// label is what explains the stepper on touch, where the title tooltip never
// shows (#104).
function ToolbarStepper({
  label,
  title,
  display,
  decLabel,
  incLabel,
  onDec,
  onInc,
  canDec,
  canInc,
}: {
  label: string;
  title: string;
  display: string;
  decLabel: string;
  incLabel: string;
  onDec: () => void;
  onInc: () => void;
  canDec: boolean;
  canInc: boolean;
}) {
  const btn =
    "px-2.5 py-1 text-sm text-fg/60 transition-colors hover:bg-fg/10 hover:text-fg disabled:pointer-events-none disabled:opacity-30";
  return (
    <div
      className="flex items-center overflow-hidden rounded-full border border-fg/10"
      title={title}
    >
      <span className="pl-2.5 text-[10px] font-medium tracking-wide text-fg/60 uppercase">
        {label}
      </span>
      <button
        type="button"
        aria-label={decLabel}
        disabled={!canDec}
        onClick={onDec}
        className={btn}
      >
        −
      </button>
      <span className="px-0.5 text-xs text-fg/60 tabular-nums">{display}</span>
      <button
        type="button"
        aria-label={incLabel}
        disabled={!canInc}
        onClick={onInc}
        className={btn}
      >
        +
      </button>
    </div>
  );
}

// The fixed bottom pill shown while editing: the page-level steppers (UI
// scale, card gap, top gap), autosave state, undo, revert to how the layout
// looked when edit mode was entered, reset to the stock arrangement, and done.
export function EditToolbar({
  status,
  error,
  scale,
  onScale,
  gap,
  onGap,
  topGap,
  onTopGap,
  canUndo,
  onUndo,
  onRevert,
  onReset,
  onDone,
}: {
  status: SaveState;
  error: string | null;
  scale: number;
  onScale: (scale: number) => void;
  gap: number;
  onGap: (gap: number) => void;
  topGap: number;
  onTopGap: (topGap: number) => void;
  canUndo: boolean;
  onUndo: () => void;
  onRevert: () => void;
  onReset: () => void;
  onDone: () => void;
}) {
  const confirm = useConfirm();
  const ghostBtn =
    "rounded-full border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm text-fg/80 transition-colors hover:bg-fg/10 disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="fixed bottom-5 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-fg/10 bg-fg/5 py-2 pr-2 pl-4 shadow-lg backdrop-blur-xl">
      <span className="text-sm font-medium text-fg/80">Editing layout</span>
      <span className="text-xs text-fg/40 lg:hidden">
        Widths apply on large screens
      </span>
      <ToolbarStepper
        label="Scale"
        title="UI scale — resizes every element, site-wide"
        display={`${scale}%`}
        decLabel="Smaller UI"
        incLabel="Larger UI"
        onDec={() => onScale(Math.max(MIN_UI_SCALE, scale - UI_SCALE_STEP))}
        onInc={() => onScale(Math.min(MAX_UI_SCALE, scale + UI_SCALE_STEP))}
        canDec={scale > MIN_UI_SCALE}
        canInc={scale < MAX_UI_SCALE}
      />
      <ToolbarStepper
        label="Card gap"
        title="Spacing between cards"
        display={`${gap}px`}
        decLabel="Less spacing between cards"
        incLabel="More spacing between cards"
        onDec={() => onGap(Math.max(MIN_GRID_GAP, gap - GRID_GAP_STEP))}
        onInc={() => onGap(Math.min(MAX_GRID_GAP, gap + GRID_GAP_STEP))}
        canDec={gap > MIN_GRID_GAP}
        canInc={gap < MAX_GRID_GAP}
      />
      <ToolbarStepper
        label="Top gap"
        title="Space above the first row of widgets — small screens cap it at 48px"
        display={`${topGap}px`}
        decLabel="Less space above the first row"
        incLabel="More space above the first row"
        onDec={() => onTopGap(Math.max(MIN_TOP_GAP, topGap - TOP_GAP_STEP))}
        onInc={() => onTopGap(Math.min(MAX_TOP_GAP, topGap + TOP_GAP_STEP))}
        canDec={topGap > MIN_TOP_GAP}
        canInc={topGap < MAX_TOP_GAP}
      />
      <SaveStatus status={status} error={error} />
      <button
        type="button"
        disabled={!canUndo}
        onClick={onUndo}
        title="Undo the last change (Ctrl+Z)"
        className={ghostBtn}
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onRevert}
        title="Go back to how the layout was when you started editing"
        className={ghostBtn}
      >
        Revert
      </button>
      <button
        type="button"
        onClick={async () => {
          const ok = await confirm({
            title: "Reset the layout to its defaults?",
            message:
              "Every widget returns to its stock position, size and visibility, and the UI scale and card spacing go back to their defaults. Ctrl+Z can still undo this while you're editing.",
            confirmLabel: "Reset layout",
            danger: true,
          });
          if (ok) onReset();
        }}
        title="Restore the stock arrangement"
        className={ghostBtn}
      >
        Reset
      </button>
      <button
        type="button"
        onClick={onDone}
        className="btn-accent rounded-full px-4 py-1.5 text-sm font-medium"
      >
        Done
      </button>
    </div>
  );
}
