"use client";

import { useState, type ReactNode } from "react";
import {
  GRID_COLUMNS,
  MAX_CARD_COLUMNS,
  MIN_WIDGET_HEIGHT,
  MAX_WIDGET_HEIGHT,
  DEFAULT_WIDGET_HEIGHT,
  WIDGET_HEIGHT_STEP,
  MAX_WIDGET_SPACE_BELOW,
  WIDGET_SPACE_STEP,
  MIN_GRID_GAP,
  MAX_GRID_GAP,
  GRID_GAP_STEP,
  MIN_UI_SCALE,
  MAX_UI_SCALE,
  UI_SCALE_STEP,
  WIDGET_LABELS,
  type LayoutWidget,
  type LayoutWidgetId,
} from "@/lib/layout";
import { MoveButtons } from "./admin/ui";
import { SaveStatus, type SaveState } from "./admin/useAutosave";

// Which edge of the hovered cell a drop would insert on, in flow order.
export type DropSide = "before" | "after";

// Native HTML5 drag reordering for the widget flow grid — the 2-D sibling of
// useReorder (components/admin/useReorder.ts). Cells can sit side by side on
// lg+ screens, so the insertion side comes from the pointer's x position within
// the hovered cell there, falling back to y when cells stack below lg. Drag is
// mouse-only by design; MoveButtons in each frame are the keyboard/touch path.
export function useFlowReorder(onMove: (from: number, to: number) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [over, setOver] = useState<{ index: number; side: DropSide } | null>(
    null
  );

  function reset() {
    setDragIndex(null);
    setOver(null);
  }

  function handlers(index: number) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = "move";
        setDragIndex(index);
      },
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault(); // required to allow dropping
        const rect = e.currentTarget.getBoundingClientRect();
        const sideBySide = window.matchMedia("(min-width: 1024px)").matches;
        const ratio = sideBySide
          ? (e.clientX - rect.left) / rect.width
          : (e.clientY - rect.top) / rect.height;
        const side: DropSide = ratio > 0.5 ? "after" : "before";
        if (over?.index !== index || over.side !== side)
          setOver({ index, side });
      },
      onDragEnd: reset,
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

  return { handlers, dragIndex, over };
}

// The insertion indicator: a vertical accent bar beside the hovered cell on lg+
// (where cells sit in a row), a horizontal one above/below it when stacked.
// Complete static class strings so Tailwind's extractor keeps every variant.
const DROP_BAR: Record<DropSide, string> = {
  before:
    "absolute right-0 left-0 -top-2 h-1 rounded-full bg-violet-400 lg:top-0 lg:bottom-0 lg:-left-2 lg:right-auto lg:h-auto lg:w-1",
  after:
    "absolute right-0 left-0 -bottom-2 h-1 rounded-full bg-violet-400 lg:top-0 lg:bottom-0 lg:-right-2 lg:left-auto lg:h-auto lg:w-1",
};

// Edit-mode chrome around one widget cell: a dashed frame with the widget's
// label, drag handle, MoveButtons (earlier/later in flow order), a span
// stepper, a cards-per-row stepper on the card-grid widgets, and a show/hide
// toggle. Renders the live widget dimmed when it's hidden, and a placeholder
// tile when it currently has nothing to show — so every widget stays visible
// and placeable while editing, with no separate palette.
export function WidgetFrame({
  widget,
  index,
  count,
  cellClass,
  node,
  emptyReason,
  effectiveCards,
  fillTo,
  titled,
  previewStyle,
  previewClass,
  onMove,
  onSpan,
  onCards,
  onHeight,
  onSpaceBelow,
  onToggleHidden,
  onToggleLabel,
  dragHandlers,
  dragging,
  dropSide,
}: {
  widget: LayoutWidget;
  index: number;
  count: number;
  cellClass: string;
  node: ReactNode;
  emptyReason: string;
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
  onSpaceBelow: (id: LayoutWidgetId, space: number | undefined) => void;
  onToggleHidden: (id: LayoutWidgetId) => void;
  onToggleLabel: (id: LayoutWidgetId) => void;
  dragHandlers: React.HTMLAttributes<HTMLDivElement>;
  dragging: boolean;
  dropSide: DropSide | null;
}) {
  const label = WIDGET_LABELS[widget.id];
  const stepBtn =
    "px-2 py-1 text-fg/60 transition-colors hover:bg-fg/10 hover:text-fg disabled:pointer-events-none disabled:opacity-30";
  return (
    <div
      {...dragHandlers}
      data-space-below={widget.spaceBelow || undefined}
      className={`relative flex flex-col gap-2 rounded-2xl p-2 outline-2 outline-dashed outline-fg/15 transition-opacity ${
        dragging ? "opacity-40" : ""
      } ${cellClass}`}
    >
      {dropSide && <span className={DROP_BAR[dropSide]} aria-hidden />}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg/60">
        <span
          className="hidden cursor-grab text-fg/30 select-none active:cursor-grabbing sm:inline"
          aria-hidden
          title="Drag to move"
        >
          ⠿
        </span>
        <span className="font-medium">{label}</span>
        {widget.hidden && (
          <span className="rounded bg-fg/10 px-1.5 py-0.5 text-[10px] tracking-wide text-fg/50 uppercase">
            Hidden
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <MoveButtons index={index} count={count} label={label} onMove={onMove} />
          <div className="flex items-center overflow-hidden rounded-lg border border-fg/10">
            <button
              type="button"
              aria-label={`Narrow ${label}`}
              disabled={widget.span <= 1}
              onClick={() => onSpan(widget.id, widget.span - 1)}
              className={stepBtn}
            >
              −
            </button>
            <span className="px-1 text-fg/50 tabular-nums">
              {widget.span}/{GRID_COLUMNS}
            </span>
            <button
              type="button"
              aria-label={`Widen ${label}`}
              disabled={widget.span >= GRID_COLUMNS}
              onClick={() => onSpan(widget.id, widget.span + 1)}
              className={stepBtn}
            >
              +
            </button>
          </div>
          {fillTo > widget.span && (
            <button
              type="button"
              onClick={() => onSpan(widget.id, fillTo)}
              title={`Widen ${label} to fill the empty space in its row`}
              className="rounded-lg border border-fg/10 px-2 py-1 text-fg/60 transition-colors hover:bg-fg/10 hover:text-fg"
            >
              Fill
            </button>
          )}
          {effectiveCards !== undefined && (
            <div
              className="flex items-center overflow-hidden rounded-lg border border-fg/10"
              title="Cards per row"
            >
              <button
                type="button"
                aria-label={`Fewer cards per row in ${label}`}
                disabled={effectiveCards <= 1}
                onClick={() => onCards(widget.id, effectiveCards - 1)}
                className={stepBtn}
              >
                −
              </button>
              <span className="px-1 text-fg/50 tabular-nums">
                {widget.cards !== undefined ? `${widget.cards}×` : "Auto"}
              </span>
              <button
                type="button"
                aria-label={`More cards per row in ${label}`}
                disabled={effectiveCards >= MAX_CARD_COLUMNS}
                onClick={() => onCards(widget.id, effectiveCards + 1)}
                className={stepBtn}
              >
                +
              </button>
              {widget.cards !== undefined && (
                <button
                  type="button"
                  aria-label={`Automatic cards per row in ${label}`}
                  onClick={() => onCards(widget.id, undefined)}
                  className={`${stepBtn} border-l border-fg/10 text-[10px] tracking-wide uppercase`}
                >
                  Auto
                </button>
              )}
            </div>
          )}
          <div
            className="flex items-center overflow-hidden rounded-lg border border-fg/10"
            title="Card height — taller than the content adds breathing room; content widgets scroll"
          >
            <button
              type="button"
              aria-label={`Shorter ${label}`}
              disabled={
                widget.height !== undefined && widget.height <= MIN_WIDGET_HEIGHT
              }
              onClick={() =>
                onHeight(
                  widget.id,
                  widget.height === undefined
                    ? DEFAULT_WIDGET_HEIGHT
                    : Math.max(
                        MIN_WIDGET_HEIGHT,
                        widget.height - WIDGET_HEIGHT_STEP
                      )
                )
              }
              className={stepBtn}
            >
              −
            </button>
            <span className="px-1 text-fg/50 tabular-nums">
              {widget.height !== undefined ? `${widget.height}px` : "Auto"}
            </span>
            <button
              type="button"
              aria-label={`Taller ${label}`}
              disabled={
                widget.height !== undefined && widget.height >= MAX_WIDGET_HEIGHT
              }
              onClick={() =>
                onHeight(
                  widget.id,
                  widget.height === undefined
                    ? DEFAULT_WIDGET_HEIGHT
                    : Math.min(
                        MAX_WIDGET_HEIGHT,
                        widget.height + WIDGET_HEIGHT_STEP
                      )
                )
              }
              className={stepBtn}
            >
              +
            </button>
            {widget.height !== undefined && (
              <button
                type="button"
                aria-label={`Automatic height for ${label}`}
                onClick={() => onHeight(widget.id, undefined)}
                className={`${stepBtn} border-l border-fg/10 text-[10px] tracking-wide uppercase`}
              >
                Auto
              </button>
            )}
          </div>
          <div
            className="flex items-center overflow-hidden rounded-lg border border-fg/10"
            title="Extra space below this card"
          >
            <button
              type="button"
              aria-label={`Less space below ${label}`}
              disabled={!widget.spaceBelow}
              onClick={() =>
                onSpaceBelow(
                  widget.id,
                  widget.spaceBelow && widget.spaceBelow > WIDGET_SPACE_STEP
                    ? widget.spaceBelow - WIDGET_SPACE_STEP
                    : undefined
                )
              }
              className={stepBtn}
            >
              −
            </button>
            <span className="px-1 text-fg/50 tabular-nums">
              {widget.spaceBelow ? `+${widget.spaceBelow}` : "0"}
            </span>
            <button
              type="button"
              aria-label={`More space below ${label}`}
              disabled={(widget.spaceBelow ?? 0) >= MAX_WIDGET_SPACE_BELOW}
              onClick={() =>
                onSpaceBelow(
                  widget.id,
                  Math.min(
                    MAX_WIDGET_SPACE_BELOW,
                    (widget.spaceBelow ?? 0) + WIDGET_SPACE_STEP
                  )
                )
              }
              className={stepBtn}
            >
              +
            </button>
          </div>
          {titled && (
            <button
              type="button"
              aria-pressed={!widget.hideLabel}
              onClick={() => onToggleLabel(widget.id)}
              title={
                widget.hideLabel
                  ? `Show the ${label} heading`
                  : `Hide the ${label} heading`
              }
              className="rounded-lg border border-fg/10 px-2 py-1 text-fg/60 transition-colors hover:bg-fg/10 hover:text-fg"
            >
              {widget.hideLabel ? "Label off" : "Label on"}
            </button>
          )}
          <button
            type="button"
            aria-pressed={widget.hidden}
            onClick={() => onToggleHidden(widget.id)}
            className="rounded-lg border border-fg/10 px-2 py-1 text-fg/60 transition-colors hover:bg-fg/10 hover:text-fg"
          >
            {widget.hidden ? "Show" : "Hide"}
          </button>
        </div>
      </div>
      {node ? (
        // Inert while editing so a drag can't trigger the widget's links; the
        // preview carries the set height so sizing shows live.
        <div
          className={`pointer-events-none ${previewClass} ${widget.hidden ? "opacity-40" : ""}`}
          style={previewStyle}
        >
          {node}
        </div>
      ) : (
        <div className="flex min-h-16 items-center justify-center rounded-xl bg-fg/[0.03] px-4 py-6 text-center text-xs text-fg/40">
          {emptyReason}
        </div>
      )}
    </div>
  );
}

// The fixed bottom pill shown while editing: the UI scale stepper, autosave
// state, revert to how the layout looked when edit mode was entered, and done.
export function EditToolbar({
  status,
  error,
  scale,
  onScale,
  gap,
  onGap,
  onRevert,
  onDone,
}: {
  status: SaveState;
  error: string | null;
  scale: number;
  onScale: (scale: number) => void;
  gap: number;
  onGap: (gap: number) => void;
  onRevert: () => void;
  onDone: () => void;
}) {
  const scaleBtn =
    "px-2.5 py-1 text-sm text-fg/60 transition-colors hover:bg-fg/10 hover:text-fg disabled:pointer-events-none disabled:opacity-30";
  return (
    <div className="fixed bottom-5 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-fg/10 bg-fg/5 py-2 pr-2 pl-4 shadow-lg backdrop-blur-xl">
      <span className="text-sm font-medium text-fg/80">Editing layout</span>
      <span className="text-xs text-fg/40 lg:hidden">
        Widths apply on large screens
      </span>
      <div
        className="flex items-center overflow-hidden rounded-full border border-fg/10"
        title="UI scale — resizes every element, site-wide"
      >
        <button
          type="button"
          aria-label="Smaller UI"
          disabled={scale <= MIN_UI_SCALE}
          onClick={() => onScale(Math.max(MIN_UI_SCALE, scale - UI_SCALE_STEP))}
          className={scaleBtn}
        >
          −
        </button>
        <span className="px-0.5 text-xs text-fg/60 tabular-nums">{scale}%</span>
        <button
          type="button"
          aria-label="Larger UI"
          disabled={scale >= MAX_UI_SCALE}
          onClick={() => onScale(Math.min(MAX_UI_SCALE, scale + UI_SCALE_STEP))}
          className={scaleBtn}
        >
          +
        </button>
      </div>
      <div
        className="flex items-center overflow-hidden rounded-full border border-fg/10"
        title="Spacing between cards"
      >
        <button
          type="button"
          aria-label="Less spacing"
          disabled={gap <= MIN_GRID_GAP}
          onClick={() => onGap(Math.max(MIN_GRID_GAP, gap - GRID_GAP_STEP))}
          className={scaleBtn}
        >
          −
        </button>
        <span className="px-0.5 text-xs text-fg/60 tabular-nums">{gap}px</span>
        <button
          type="button"
          aria-label="More spacing"
          disabled={gap >= MAX_GRID_GAP}
          onClick={() => onGap(Math.min(MAX_GRID_GAP, gap + GRID_GAP_STEP))}
          className={scaleBtn}
        >
          +
        </button>
      </div>
      <SaveStatus status={status} error={error} />
      <button
        type="button"
        onClick={onRevert}
        className="rounded-full border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm text-fg/80 transition-colors hover:bg-fg/10"
      >
        Revert
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
