"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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
  type LayoutWidget,
  type SpaceSide,
} from "@/lib/layout";
import { MoveButtons } from "./admin/ui";
import { useConfirm } from "./admin/Confirm";
import { SaveStatus, type SaveState } from "./admin/useAutosave";
import { useDragResize, CORNERS, type Corner, type ResizeDrag } from "./useDragResize";

// Where each diagonal handle sits, just off the card's corner, with the
// cursor for its diagonal.
const CORNER_CLASSES: Record<Corner, string> = {
  "top-left": "-top-[13px] -left-[13px] cursor-nwse-resize",
  "top-right": "-top-[13px] -right-[13px] cursor-nesw-resize",
  "bottom-left": "-bottom-[13px] -left-[13px] cursor-nesw-resize",
  "bottom-right": "-right-[13px] -bottom-[13px] cursor-nwse-resize",
};
import type { CardDrag } from "./usePointerReorder";
import { useUndoGesture } from "./useUndoHistory";

const stepBtn =
  "px-2 py-1 text-ink-60 transition-colors select-none touch-none hover:bg-fg/10 hover:text-fg disabled:pointer-events-none disabled:opacity-30 pointer-coarse:px-3 pointer-coarse:py-2.5";

// Press-and-hold auto-repeat for a stepper button (#102): a click steps once
// as before; holding the button repeats the step after a short delay, so
// touch and keyboard users aren't stuck clicking 16 times to walk a span
// across the grid. The action and its range guard live in a ref so every
// repeat sees the latest values (the props change on each step), and the
// guard stops the timer at the range's end. Spread the returned handlers on
// the button INSTEAD of an onClick.
const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 60;

function useHoldRepeat(action: () => void, canRun: boolean) {
  // A hold is one undo step (#314), however many repeats it fires.
  const gesture = useUndoGesture();
  const live = useRef({ action, canRun });
  useEffect(() => {
    live.current = { action, canRun };
  });
  const timers = useRef<{ delay?: number; interval?: number; fired: boolean; holding?: boolean }>(
    { fired: false }
  );

  const stop = useCallback(() => {
    window.clearTimeout(timers.current.delay);
    window.clearInterval(timers.current.interval);
    timers.current.delay = timers.current.interval = undefined;
    // Only the gesture this hold opened: a stepper unmounting mid-drag (the
    // height stepper moves into More as a resize narrows the card) mustn't
    // close a resize gesture.
    if (timers.current.holding) gesture.end();
    timers.current.holding = false;
  }, [gesture]);
  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    stop();
    gesture.begin();
    timers.current.holding = true;
    timers.current.fired = false;
    timers.current.delay = window.setTimeout(() => {
      timers.current.interval = window.setInterval(() => {
        if (!live.current.canRun) {
          stop();
          return;
        }
        timers.current.fired = true;
        live.current.action();
      }, HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  }, [stop, gesture]);

  return {
    // Capture the pointer for the duration of the hold: each step can move
    // the button under the stationary pointer (widening a card shifts its
    // whole control strip), which would otherwise fire pointerleave and kill
    // the hold after one repeat.
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      start();
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    // The click that follows releasing a hold must not step once more; a
    // plain click (or Enter/Space) steps exactly once.
    onClick: () => {
      if (timers.current.fired) {
        timers.current.fired = false;
        return;
      }
      live.current.action();
    },
  };
}

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
  const holdDec = useHoldRepeat(onDec, canDec);
  const holdInc = useHoldRepeat(onInc, canInc);
  return (
    <div
      className={`flex items-center overflow-hidden rounded-lg border border-fg/10 ${className}`}
      title={title}
    >
      <button
        type="button"
        aria-label={decLabel}
        disabled={!canDec}
        data-undo-merge
        {...holdDec}
        className={stepBtn}
      >
        −
      </button>
      <span className="px-1 text-ink-70 tabular-nums">{display}</span>
      <button
        type="button"
        aria-label={incLabel}
        disabled={!canInc}
        data-undo-merge
        {...holdInc}
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
function MoreMenu({ children, up = false }: { children: ReactNode; up?: boolean }) {
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
      data-editor-more
      className="relative shrink-0"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center rounded-lg border border-fg/10 px-2 py-1 text-ink-60 transition-colors hover:bg-fg/10 hover:text-fg [&::-webkit-details-marker]:hidden">
        More
      </summary>
      <div
        className={`absolute right-0 z-10 flex w-56 flex-col gap-3 rounded-xl border border-fg/10 bg-[var(--background)] p-3 shadow-lg ${
          up ? "bottom-full mb-1" : "top-full mt-1"
        }`}
      >
        {children}
      </div>
    </details>
  );
}

// Whether the large-screen layout is in effect (lg+: spans apply and cells sit
// side by side). Server and first paint assume large; the editor only mounts
// after an admin opens it.
const LARGE_QUERY = "(min-width: 1024px)";
export function useIsLarge(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(LARGE_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(LARGE_QUERY).matches,
    () => true
  );
}

// Where a selected card's toolbar docks on small screens: a slot in the
// bottom editor bar (EditToolbar renders it).
export const SELECTION_SLOT_ID = "layout-selection-slot";

// One widget cell in the editor (#313). Unselected it is the live card plus a
// thin outline and a small name tag floating over its top-right corner —
// nothing in the flow changes, so the editor packs exactly like the live
// page. The cell is a focusable group: Tab moves between cards, a click or
// Enter/Space selects one, and then
// - one compact toolbar (move, width and Fill, height, More, Hide) floats
//   over the page above or below the card, or docks into the bottom editor
//   bar on small screens;
// - the resize handles on its edges take a drag or arrow keys;
// - arrow keys move the card one place, Shift+arrows resize it (left/right
//   width, up/down height), and Escape deselects (useLayoutEditor).
// The content is inert: links and fields in it can't take focus or clicks.
// Hidden and empty widgets live in the Dashboard's tray instead.
export function WidgetFrame({
  widget,
  label,
  index,
  count,
  cellClass,
  node,
  effectiveCards,
  fillTo,
  titled,
  previewStyle,
  previewClass,
  selected,
  onSelect,
  onAnnounce,
  onMove,
  onSpan,
  onCards,
  onHeight,
  onSpace,
  onToggleHidden,
  onToggleLabel,
  onConfigure,
  onGrab,
  clickEndsDrag,
  placeholder = false,
  moving = false,
  landed = false,
}: {
  widget: LayoutWidget;
  // Display name for this entry — the instance's title, else its type's
  // label, numbered when several share it. The per-widget callbacks key on
  // the instance id, not the type.
  label: string;
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
  // The live cell's height style and classes, on the content box.
  previewStyle?: React.CSSProperties;
  previewClass: string;
  selected: boolean;
  onSelect: (key: string) => void;
  // Say something through the editor's live region.
  onAnnounce: (message: string) => void;
  onMove: (from: number, to: number) => void;
  onSpan: (key: string, span: number) => void;
  onCards: (key: string, cards: number | undefined) => void;
  onHeight: (key: string, height: number | undefined) => void;
  onSpace: (key: string, side: SpaceSide, value: number | undefined) => void;
  onToggleHidden: (key: string) => void;
  onToggleLabel: (key: string) => void;
  // Open the widget's settings beside the page (#303).
  onConfigure: (key: string) => void;
  // A press on the card, which becomes a move drag past the slop or after a
  // long press (usePointerReorder, #312).
  onGrab: (e: React.PointerEvent<HTMLDivElement>) => void;
  // Whether the click now arriving ends a drag (and so selects nothing).
  clickEndsDrag: () => boolean;
  // The slot this card would land in while it's being dragged: the card,
  // invisible but holding its exact size, inside a dashed outline.
  placeholder?: boolean;
  // Some card is being dragged: toolbars and handles stand down.
  moving?: boolean;
  // Just shown from the tray (#315): outlined for a moment.
  landed?: boolean;
}) {
  const key = widget.id;
  const isLarge = useIsLarge();
  const gesture = useUndoGesture();
  const { frameRef, previewRef, drag, widthHandle, heightHandle, cornerHandle } = useDragResize(
    {
      span: widget.span,
      height: widget.height,
      onSpan: (span) => onSpan(key, span),
      onHeight: (height) => onHeight(key, height),
    }
  );
  // A keyboard move re-inserts the cell in the DOM, which drops its focus;
  // take it back once the move has rendered.
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    frameRef.current?.focus({ preventScroll: true });
    frameRef.current?.scrollIntoView({ block: "nearest" });
  });

  const clampSpan = (n: number) => Math.min(GRID_COLUMNS, Math.max(1, n));
  const clampHeight = (n: number) => Math.min(MAX_WIDGET_HEIGHT, Math.max(MIN_WIDGET_HEIGHT, n));
  // A height step from "Auto" starts at what's on screen, snapped to the step.
  const currentHeight = () =>
    widget.height ??
    clampHeight(
      Math.round((previewRef.current?.getBoundingClientRect().height ?? DEFAULT_WIDGET_HEIGHT) / WIDGET_HEIGHT_STEP) *
        WIDGET_HEIGHT_STEP
    );

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Only keys aimed at the card itself — not its toolbar or handles.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(key);
      return;
    }
    if (!selected || e.altKey || e.ctrlKey || e.metaKey) return;
    const dir =
      e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    if (!e.shiftKey) {
      const to = index + dir;
      if (to < 0 || to >= count) return;
      refocus.current = true;
      onMove(index, to);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      // Widths only apply on large screens.
      if (!isLarge) return;
      const next = clampSpan(widget.span + dir);
      if (next === widget.span) return;
      gesture.group(`span:${key}`);
      onSpan(key, next);
      onAnnounce(`${label} width ${next} of ${GRID_COLUMNS} columns`);
    } else {
      // Up is taller, as on the height handle.
      const next = clampHeight(currentHeight() - dir * WIDGET_HEIGHT_STEP);
      gesture.group(`height:${key}`);
      onHeight(key, next);
      onAnnounce(`${label} height ${next} pixels`);
    }
  }

  const space = widget.space ?? {};
  const heightStepper = (className = "") => (
    <StepGroup
      className={className}
      title="Card height — or drag the bottom edge; taller than the content adds breathing room, content widgets scroll. On small screens only scrolling widgets keep their height — the rest stack at auto height."
      display={widget.height !== undefined ? `${widget.height}px` : "Auto"}
      decLabel={`Shorter ${label}`}
      incLabel={`Taller ${label}`}
      onDec={() => onHeight(key, clampHeight(currentHeight() - WIDGET_HEIGHT_STEP))}
      onInc={() => onHeight(key, clampHeight(currentHeight() + WIDGET_HEIGHT_STEP))}
      canDec={widget.height === undefined || widget.height > MIN_WIDGET_HEIGHT}
      canInc={widget.height === undefined || widget.height < MAX_WIDGET_HEIGHT}
      extra={
        widget.height !== undefined && (
          <button
            type="button"
            aria-label={`Automatic height for ${label}`}
            onClick={() => onHeight(key, undefined)}
            className={`${stepBtn} border-l border-fg/10 text-[10px] tracking-wide uppercase`}
          >
            Auto
          </button>
        )
      }
    />
  );

  const controls = (
    <FrameToolbar label={label} docked={!isLarge} frameRef={frameRef}>
      <MoveButtons index={index} count={count} label={label} onMove={onMove} flow row />
      {isLarge && (
        <StepGroup
          title={`Column width: ${widget.span} of ${GRID_COLUMNS} columns — drag the right edge to resize. Widths apply on large screens.`}
          display={`${widget.span}/${GRID_COLUMNS}`}
          decLabel={`Narrow ${label}`}
          incLabel={`Widen ${label}`}
          onDec={() => onSpan(key, widget.span - 1)}
          onInc={() => onSpan(key, widget.span + 1)}
          canDec={widget.span > 1}
          canInc={widget.span < GRID_COLUMNS}
        />
      )}
      {/* Parked during a resize drag: the span changes every step, so the
          button popping in/out would shift the toolbar mid-gesture. */}
      {isLarge && !drag && fillTo > widget.span && (
        <button
          type="button"
          onClick={() => onSpan(key, fillTo)}
          title={`Widen ${label} to fill the empty space in its row`}
          className={toolBtn}
        >
          Fill
        </button>
      )}
      {heightStepper()}
      <MoreMenu up={!isLarge}>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] tracking-wide text-ink-60 uppercase">Space around card</span>
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
                  onSpace(key, side, cur > WIDGET_SPACE_STEP ? cur - WIDGET_SPACE_STEP : undefined);
                }}
                onInc={() => onSpace(key, side, Math.min(MAX_WIDGET_SPACE, (space[side] ?? 0) + WIDGET_SPACE_STEP))}
                canDec={!!space[side]}
                canInc={(space[side] ?? 0) < MAX_WIDGET_SPACE}
              />
            ))}
          </div>
        </div>
        {effectiveCards !== undefined && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] tracking-wide text-ink-60 uppercase">Cards / row</span>
            <StepGroup
              display={widget.cards !== undefined ? `${widget.cards}×` : "Auto"}
              decLabel={`Fewer cards per row in ${label}`}
              incLabel={`More cards per row in ${label}`}
              onDec={() => onCards(key, effectiveCards - 1)}
              onInc={() => onCards(key, effectiveCards + 1)}
              canDec={effectiveCards > 1}
              canInc={effectiveCards < MAX_CARD_COLUMNS}
              extra={
                widget.cards !== undefined && (
                  <button
                    type="button"
                    aria-label={`Automatic cards per row in ${label}`}
                    onClick={() => onCards(key, undefined)}
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
          <button type="button" aria-pressed={!widget.hideLabel} onClick={() => onToggleLabel(key)} className={toolBtn}>
            {widget.hideLabel ? "Show heading" : "Hide heading"}
          </button>
        )}
      </MoreMenu>
      <button
        type="button"
        onClick={() => onConfigure(key)}
        title={`Edit what ${label} shows`}
        className={toolBtn}
      >
        Configure
      </button>
      <button
        type="button"
        onClick={() => onToggleHidden(key)}
        title={`Hide ${label} from the page (it moves to the tray below)`}
        className={toolBtn}
      >
        Hide
      </button>
    </FrameToolbar>
  );

  // A handle is a generous hit strip along the card's outline with a small
  // visible grip in its middle.
  const showHandles = (selected || drag) && !moving && !placeholder;
  const handleClass = `group/handle absolute z-20 flex touch-none items-center justify-center outline-none transition-opacity ${
    showHandles ? "opacity-100" : moving || placeholder ? "hidden" : "opacity-0 group-hover/frame:opacity-100"
  }`;
  const grip =
    "rounded-full bg-violet-400 shadow-sm transition-transform group-hover/handle:scale-110 group-focus-visible/handle:outline-2 group-focus-visible/handle:outline-offset-2 group-focus-visible/handle:outline-violet-400";

  return (
    <div
      ref={frameRef}
      data-widget-id={key}
      data-selected={selected || undefined}
      role="group"
      aria-label={label}
      aria-roledescription="widget"
      aria-describedby={selected ? "layout-selected-help" : "layout-card-help"}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onGrab}
      onClick={(e) => {
        if (clickEndsDrag()) return;
        // Clicks in the toolbar or on a handle don't (re)select.
        if ((e.target as HTMLElement).closest("[data-frame-chrome]")) return;
        onSelect(key);
      }}
      // A long press starts a drag on touch; no callout menu on top of it.
      onContextMenu={(e) => e.preventDefault()}
      data-space-top={space.top || undefined}
      data-space-right={space.right || undefined}
      data-space-bottom={space.bottom || undefined}
      data-space-left={space.left || undefined}
      className={`group/frame relative cursor-grab rounded-2xl outline-offset-4 transition-[outline-color] select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet-400 ${
        placeholder
          ? "bg-violet-400/10 outline-2 outline-dashed outline-violet-400"
          : selected || landed
            ? "outline-2 outline-solid outline-violet-400"
            : "outline-1 outline-dashed outline-fg/25 hover:outline-fg/50"
      } ${cellClass}`}
    >
      {/* The live card, as visitors get it. Inert: the editor owns every
          click and Tab stop here. */}
      <div
        ref={previewRef}
        inert
        className={`${previewClass} ${placeholder ? "invisible" : ""}`}
        style={previewStyle}
      >
        {node}
      </div>
      {/* The name tag, over the card's top-right corner (section headings
          start at the top left). The group's own label already names the
          card, so the tag is hidden from assistive tech. */}
      <span
        aria-hidden
        className={`absolute -top-2.5 right-3 z-20 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-full border px-2 py-px text-[10px] leading-4 font-medium whitespace-nowrap shadow-sm ${placeholder ? "invisible" : ""} ${
          selected
            ? "border-violet-500 bg-violet-600 text-white"
            : "border-fg/15 bg-[var(--background)] text-ink-70"
        }`}
      >
        <span aria-hidden>⠿</span>
        <span className="truncate">{label}</span>
      </span>
      {selected && !moving && !placeholder && controls}
      {/* Drag-to-resize (#312): the right edge sets the width (lg+, where
          spans apply), the bottom edge the height, any corner both (#343). Shown on
          hover and on the selected card; the edges are focusable (as
          sliders) only on the selected one, so Tab still walks card to card.
          Up/Right increases per the ARIA convention, Home/End jump the range,
          and Delete returns the height to automatic. */}
      {isLarge && (
        <span
          {...widthHandle}
          data-frame-chrome
          data-undo-merge
          role="slider"
          tabIndex={selected ? 0 : -1}
          aria-label={`${label} width`}
          aria-valuenow={widget.span}
          aria-valuemin={1}
          aria-valuemax={GRID_COLUMNS}
          aria-valuetext={`${widget.span} of ${GRID_COLUMNS} columns`}
          onKeyDown={(e) => {
            const next =
              e.key === "ArrowRight" || e.key === "ArrowUp"
                ? widget.span + 1
                : e.key === "ArrowLeft" || e.key === "ArrowDown"
                  ? widget.span - 1
                  : e.key === "Home"
                    ? 1
                    : e.key === "End"
                      ? GRID_COLUMNS
                      : null;
            if (next === null) return;
            e.preventDefault();
            onSpan(key, next);
          }}
          className={`${handleClass} top-3 -right-[11px] bottom-3 w-3.5 cursor-col-resize pointer-coarse:w-6`}
        >
          <span className={`${grip} h-10 w-1.5 pointer-coarse:w-2`} />
        </span>
      )}
      <span
        {...heightHandle}
        data-frame-chrome
        data-undo-merge
        role="slider"
        tabIndex={selected ? 0 : -1}
        aria-label={`${label} height`}
        aria-valuenow={widget.height ?? DEFAULT_WIDGET_HEIGHT}
        aria-valuemin={MIN_WIDGET_HEIGHT}
        aria-valuemax={MAX_WIDGET_HEIGHT}
        aria-valuetext={widget.height !== undefined ? `${widget.height} pixels` : "Automatic"}
        onKeyDown={(e) => {
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            onHeight(key, undefined);
            return;
          }
          const next =
            e.key === "ArrowUp" || e.key === "ArrowRight"
              ? clampHeight(currentHeight() + WIDGET_HEIGHT_STEP)
              : e.key === "ArrowDown" || e.key === "ArrowLeft"
                ? clampHeight(currentHeight() - WIDGET_HEIGHT_STEP)
                : e.key === "Home"
                  ? MIN_WIDGET_HEIGHT
                  : e.key === "End"
                    ? MAX_WIDGET_HEIGHT
                    : null;
          if (next === null) return;
          e.preventDefault();
          onHeight(key, next);
        }}
        className={`${handleClass} right-3 -bottom-[11px] left-3 h-3.5 cursor-row-resize pointer-coarse:h-6`}
      >
        <span className={`${grip} h-1.5 w-10 pointer-coarse:h-2`} />
      </span>
      {isLarge &&
        CORNERS.map((corner) => (
          <span
            key={corner}
            {...cornerHandle(corner)}
            data-frame-chrome
            aria-hidden
            className={`${handleClass} size-5 ${CORNER_CLASSES[corner]}`}
          >
            <span className={`${grip} size-2.5`} />
          </span>
        ))}
      {drag && <ResizeFeedback drag={drag} />}
    </div>
  );
}

// The card being dragged (#312), floating under the pointer, slightly lifted:
// a grid card at its own size (scaled down when it's big, so the preview
// underneath stays visible), a tray widget as its chip. A portal, fixed to
// the viewport; inert.
export function DragGhost({ drag, label, node }: { drag: CardDrag; label: string; node: ReactNode }) {
  if (drag.from === null) {
    return createPortal(
      <div
        aria-hidden
        className="pointer-events-none fixed z-[60] rounded-lg border border-violet-400 bg-[var(--background)] px-2.5 py-1.5 text-xs font-medium text-ink-80 shadow-xl"
        style={{ left: drag.x + 8, top: drag.y + 8 }}
      >
        {label}
      </div>,
      document.body
    );
  }
  const scale = Math.min(1, 420 / drag.width, 320 / drag.height);
  return createPortal(
    <div
      aria-hidden
      inert
      className="pointer-events-none fixed top-0 left-0 z-[60] origin-top-left rounded-2xl opacity-90 shadow-2xl ring-2 ring-violet-400"
      style={{
        width: drag.width,
        height: drag.height,
        transform: `translate(${drag.x - drag.grabX * scale}px, ${drag.y - drag.grabY * scale}px) scale(${scale})`,
      }}
    >
      {node}
    </div>,
    document.body
  );
}

// While a resize drag runs: the new value in a badge beside the pointer
// (never over the card's content), and for a width the grid's 24 columns
// faintly drawn, the card's own tinted. Fixed to the viewport, in a portal so
// no transformed ancestor can shift it.
function ResizeFeedback({ drag }: { drag: NonNullable<ResizeDrag> }) {
  const width = drag.kind !== "height";
  const height = drag.kind !== "width";
  const parts = [
    width ? `${drag.span}/${GRID_COLUMNS}` : null,
    height ? (drag.height === undefined ? "Auto" : `${drag.height}px`) : null,
  ].filter(Boolean);
  let guides: ReactNode = null;
  if (width) {
    const { left, width: gridWidth, gap } = drag.grid;
    guides = (
      <div
        aria-hidden
        className="pointer-events-none fixed top-0 z-[35] grid h-screen"
        style={{ left, width: gridWidth, columnGap: gap, gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)` }}
      >
        {Array.from({ length: GRID_COLUMNS }, (_, i) => (
          <div
            key={i}
            className={
              i >= drag.startColumn && i < drag.startColumn + drag.span ? "bg-violet-400/[0.08]" : "bg-fg/[0.025]"
            }
          />
        ))}
      </div>
    );
  }
  return createPortal(
    <>
      {guides}
      <span
        aria-hidden
        className="pointer-events-none fixed z-[60] rounded-md bg-violet-600 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums shadow"
        style={{ left: drag.x + 16, top: drag.y + 16 }}
      >
        {parts.join(" · ")}
      </span>
    </>,
    document.body
  );
}

const toolBtn =
  "shrink-0 rounded-lg border border-fg/10 px-2 py-1 text-ink-60 transition-colors hover:bg-fg/10 hover:text-fg pointer-coarse:py-2";

// The selected card's toolbar. On large screens it floats over the page just
// above the card — below it when there's no room above — and lines up with
// the card's right edge when it would run off the screen. On small screens it
// docks into the bottom editor bar instead.
function FrameToolbar({
  label,
  docked,
  frameRef,
  children,
}: {
  label: string;
  docked: boolean;
  frameRef: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The slot is rendered by the editor bar, which is on screen whenever a
  // card can be selected (the toolbar only renders for a selection, on the
  // client).
  const slot = docked && typeof document !== "undefined" ? document.getElementById(SELECTION_SLOT_ID) : null;
  // Place it after every render: the card moves and resizes under it.
  useLayoutEffect(() => {
    const bar = ref.current;
    const frame = frameRef.current;
    if (!bar || !frame || docked) return;
    const f = frame.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    bar.dataset.below = f.top - b.height - 12 < 0 ? "true" : "false";
    bar.dataset.right = f.left + b.width > window.innerWidth - 8 ? "true" : "false";
  });
  const bar = (
    <div
      ref={ref}
      data-frame-chrome
      role="toolbar"
      aria-label={`${label} controls`}
      className={
        docked
          ? "flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs text-ink-60"
          : "absolute bottom-full left-0 z-30 mb-3 flex w-max items-center gap-1.5 rounded-xl border border-fg/10 bg-[var(--background)] p-1.5 text-xs text-ink-60 shadow-lg data-[below=true]:top-full data-[below=true]:bottom-auto data-[below=true]:mt-3 data-[below=true]:mb-0 data-[right=true]:right-0 data-[right=true]:left-auto"
      }
    >
      {docked && <span className="shrink-0 pr-1 font-medium text-ink-80">{label}</span>}
      {children}
    </div>
  );
  if (docked) return slot ? createPortal(bar, slot) : null;
  return bar;
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
    "px-2.5 py-1 text-sm text-ink-60 transition-colors select-none touch-none hover:bg-fg/10 hover:text-fg disabled:pointer-events-none disabled:opacity-30 pointer-coarse:py-2.5";
  const holdDec = useHoldRepeat(onDec, canDec);
  const holdInc = useHoldRepeat(onInc, canInc);
  return (
    <div
      className="flex items-center overflow-hidden rounded-full border border-fg/10"
      title={title}
    >
      <span className="pl-2.5 text-[10px] font-medium tracking-wide text-ink-60 uppercase">
        {label}
      </span>
      <button
        type="button"
        aria-label={decLabel}
        disabled={!canDec}
        data-undo-merge
        {...holdDec}
        className={btn}
      >
        −
      </button>
      <span className="px-0.5 text-xs text-ink-60 tabular-nums">{display}</span>
      <button
        type="button"
        aria-label={incLabel}
        disabled={!canInc}
        data-undo-merge
        {...holdInc}
        className={btn}
      >
        +
      </button>
    </div>
  );
}

// The edit toolbar: the page-level steppers (UI scale, card gap, top gap),
// autosave state, undo and redo, revert to how the layout looked when edit mode was
// entered, reset to the stock arrangement, and done.
//
// Large screens get one floating pill. Small screens get a full-width bar
// pinned to the bottom edge (#271): a centered pill that wraps turned into a
// tall circle running off-screen, hiding Done. There, row one keeps the
// essentials (status, Undo, Done) always in reach and row two scrolls
// sideways. The rows are `lg:contents`, so on large screens their children
// flow into the single pill row: the label and steppers keep source order
// (order 0) and `lg:order-*` puts status, Undo, Revert, Reset and Done after.
// `lg:w-max`: centered with left-1/2, a fixed box's shrink-to-fit width is
// capped at the right half of the screen, which wrapped the pill in two.
// z-[45]: above the floating gear (z-40), which otherwise sat on the phone
// bar's second row, and below dialogs (z-50).
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
  canRedo,
  onRedo,
  onRevert,
  onReset,
  resetsToEmpty,
  onDone,
  leading,
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
  canRedo: boolean;
  onRedo: () => void;
  onRevert: () => void;
  onReset: () => void;
  // A board other than the home board resets to empty, not the stock set.
  resetsToEmpty: boolean;
  onDone: () => void;
  // The board menu and the add-widget palette (#303): first after the title
  // on large screens, first in the scrolling row on small ones.
  leading?: ReactNode;
}) {
  const confirm = useConfirm();
  const ghostBtn =
    "shrink-0 rounded-full border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm text-ink-80 transition-colors hover:bg-fg/10 disabled:pointer-events-none disabled:opacity-40";
  return (
    <div
      role="toolbar"
      aria-label="Layout editor"
      data-editor-keep
      className="fixed inset-x-0 bottom-0 z-[45] flex flex-col gap-2 border-t border-fg/10 bg-[var(--background)]/90 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg backdrop-blur-xl lg:inset-x-auto lg:bottom-5 lg:left-[calc(50%-var(--editor-panel,0px)/2)] lg:w-max lg:max-w-[calc(100vw-2rem-var(--editor-panel,0px))] lg:-translate-x-1/2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-center lg:gap-x-3 lg:gap-y-1 lg:rounded-full lg:border lg:py-2 lg:pr-2 lg:pl-4"
    >
      {/* Where the selected card's controls dock on small screens (#313). */}
      <div id={SELECTION_SLOT_ID} className="empty:hidden lg:hidden" />
      <div className="flex items-center gap-2 lg:contents">
        <span className="text-sm font-medium whitespace-nowrap text-ink-80">Editing layout</span>
        <span className="lg:order-5">
          <SaveStatus status={status} error={error} />
        </span>
        <span className="flex-1 lg:hidden" aria-hidden />
        <button
          type="button"
          disabled={!canUndo}
          onClick={onUndo}
          title="Undo the last change (Ctrl+Z)"
          className={`${ghostBtn} lg:order-6`}
        >
          <span aria-hidden className="lg:hidden">
            ↶
          </span>
          <span className="max-lg:sr-only">Undo</span>
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={onRedo}
          title="Redo what you undid (Ctrl+Shift+Z)"
          className={`${ghostBtn} lg:order-6`}
        >
          <span aria-hidden className="lg:hidden">
            ↷
          </span>
          <span className="max-lg:sr-only">Redo</span>
        </button>
        <button
          type="button"
          onClick={onDone}
          className="btn-accent shrink-0 rounded-full px-4 py-1.5 text-sm font-medium lg:order-9"
        >
          Done
        </button>
      </div>
      <div className="-mx-3 flex items-center gap-2 overflow-x-auto px-3 pb-0.5 lg:contents">
        {leading}
        <span className="shrink-0 text-xs text-ink-60 lg:hidden">
          Widths apply on large screens
        </span>
        <div className="flex shrink-0 items-center gap-2 lg:contents">
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
        </div>
        <button
          type="button"
          onClick={onRevert}
          title="Go back to how the layout was when you started editing"
          className={`${ghostBtn} lg:order-7`}
        >
          Revert
        </button>
        <button
          type="button"
          onClick={async () => {
            const ok = await confirm({
              title: resetsToEmpty ? "Clear this board?" : "Reset the layout to its defaults?",
              message: resetsToEmpty
                ? "Every widget leaves this board for the tray below, and the UI scale and card spacing go back to their defaults. Ctrl+Z can still undo this while you're editing."
                : "Every widget returns to its stock position, size and visibility, and the UI scale and card spacing go back to their defaults. Ctrl+Z can still undo this while you're editing.",
              confirmLabel: resetsToEmpty ? "Clear board" : "Reset layout",
              danger: true,
            });
            if (ok) onReset();
          }}
          title={resetsToEmpty ? "Move every widget to the tray" : "Restore the stock arrangement"}
          className={`${ghostBtn} lg:order-8`}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
