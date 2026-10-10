"use client";

// Moving cards in the layout editor by dragging them (#312): one pointer-event
// gesture for mouse, pen and touch, replacing HTML5 drag-and-drop.
// - Grab a card anywhere. A mouse drag starts after a few pixels, so a click
//   still selects; on touch a long press starts it, so a swipe still scrolls.
// - While dragging, the page shows the result: the grid renders in the order
//   a drop would leave, with an invisible copy of the card holding its slot
//   (Dashboard), and the card itself floats under the pointer.
// - The page scrolls when the pointer nears the top or bottom edge.
// - Escape cancels and puts everything back.
// - Cards drag between the grid and the tray: onto the tray hides a card,
//   and a hidden widget dragged from the tray into the grid lands where it's
//   dropped.
// Nothing changes until the drop, which is one change and so one undo step.
import { useCallback, useEffect, useRef, useState } from "react";

export type Rect = { left: number; top: number; right: number; bottom: number };
type Point = { x: number; y: number };

export type DropCard = { rect: Rect; fullRow: boolean };

const inside = (r: Rect, p: Point) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
const distance = (r: Rect, p: Point) =>
  Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom));

// Where the dragged card would land: its index among the other cards (which
// keep their relative order), given where they are on screen now.
// - Over the card's own placeholder, nothing changes: once the preview has
//   moved the slot under the pointer, holding still stays put.
// - Otherwise the nearest card decides: before it or after it, by which half
//   of it the pointer is on — across for cards side by side, down for stacked
//   or full-row ones. A band around its middle keeps the current answer, so
//   the target doesn't flicker between two slots.
export function dropIndex({
  pointer,
  cards,
  placeholder,
  current,
  sideBySide,
}: {
  pointer: Point;
  cards: DropCard[];
  placeholder: Rect | null;
  current: number;
  sideBySide: boolean;
}): number {
  if (cards.length === 0) return 0;
  if (placeholder && inside(placeholder, pointer)) return current;
  let nearest = 0;
  let best = Infinity;
  cards.forEach((c, i) => {
    const d = distance(c.rect, pointer);
    if (d < best) {
      best = d;
      nearest = i;
    }
  });
  const { rect, fullRow } = cards[nearest];
  const across = sideBySide && !fullRow;
  const ratio = across
    ? (pointer.x - rect.left) / Math.max(1, rect.right - rect.left)
    : (pointer.y - rect.top) / Math.max(1, rect.bottom - rect.top);
  const target = ratio >= 0.5 ? nearest + 1 : nearest;
  // The dead band only holds an answer that's already beside this card.
  if (ratio > 0.4 && ratio < 0.6 && (current === nearest || current === nearest + 1)) return current;
  return target;
}

export type CardDrag = {
  id: string;
  // Its visible index when it came from the grid; null from the tray.
  from: number | null;
  // Where it would land among the other visible cards; null while a tray
  // widget isn't over the grid yet.
  to: number | null;
  overTray: boolean;
  // The pointer, the grab point within the card, and the card's size.
  x: number;
  y: number;
  grabX: number;
  grabY: number;
  width: number;
  height: number;
};

const MOUSE_SLOP = 6;
const TOUCH_SLOP = 8;
const LONG_PRESS_MS = 250;
const RETARGET_MS = 100;
const SCROLL_ZONE_TOP = 72;
// Above the editor bar.
const SCROLL_ZONE_BOTTOM = 110;
const SCROLL_MAX = 18;

const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

export function usePointerReorder({
  enabled,
  gridRef,
  trayRef,
  onMove,
  onHide,
  onPlace,
}: {
  // Edit mode is on.
  enabled: boolean;
  gridRef: React.RefObject<HTMLElement | null>;
  trayRef: React.RefObject<HTMLElement | null>;
  // A grid card dropped somewhere else in the grid.
  onMove: (id: string, from: number, to: number) => void;
  // A grid card dropped on the tray.
  onHide: (id: string) => void;
  // A tray widget dropped in the grid, at this visible index.
  onPlace: (id: string, to: number) => void;
}) {
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const dragRef = useRef<CardDrag | null>(null);
  // Set when a drag ends, so the click that follows the pointerup doesn't
  // select or toggle anything.
  const suppressClick = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onMove, onHide, onPlace });
  useEffect(() => {
    callbacks.current = { onMove, onHide, onPlace };
  });
  useEffect(() => () => cleanupRef.current?.(), []);
  // While a touch drag is live, keep the browser from scrolling under it.
  // The listener has to be in place before the touch starts — the browser
  // decides then whether it may scroll without asking — so it stays on for
  // all of edit mode and only acts during a drag.
  const touchDragging = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const block = (e: TouchEvent) => {
      if (touchDragging.current) e.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, [enabled]);

  const update = useCallback((next: CardDrag | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  // Where the drag would land now, from the cards on screen.
  const retarget = useCallback((d: CardDrag): CardDrag => {
    const pointer = { x: d.x, y: d.y };
    const tray = trayRef.current?.getBoundingClientRect();
    const overTray = !!tray && inside(toRect(tray), pointer);
    const grid = gridRef.current;
    if (!grid) return { ...d, overTray };
    const gridRect = grid.getBoundingClientRect();
    // A tray widget joins the grid once the pointer comes near it.
    if (d.from === null && d.to === null && (overTray || pointer.y > gridRect.bottom + 48)) {
      return { ...d, overTray };
    }
    const cells = Array.from(grid.querySelectorAll<HTMLElement>(":scope > [data-widget-id]"));
    const placeholder = cells.find((c) => c.dataset.widgetId === d.id);
    const others = cells.filter((c) => c !== placeholder);
    const to = dropIndex({
      pointer,
      cards: others.map((c) => {
        const r = c.getBoundingClientRect();
        return { rect: toRect(r), fullRow: r.width >= gridRect.width - 1 };
      }),
      placeholder: placeholder ? toRect(placeholder.getBoundingClientRect()) : null,
      current: d.to ?? others.length,
      sideBySide: window.matchMedia("(min-width: 1024px)").matches,
    });
    return { ...d, overTray, to: overTray && d.from === null ? d.to : to };
  }, [gridRef, trayRef]);

  // Start tracking a press on a card (from = its visible index) or a tray
  // chip (from = null). Becomes a drag past the slop, or after a long press
  // on touch.
  const begin = useCallback(
    (e: React.PointerEvent<HTMLElement>, id: string, from: number | null) => {
      if (e.button !== 0 || dragRef.current) return;
      if ((e.target as Element).closest("[data-frame-chrome], button, a, input, select, textarea")) return;
      const touch = e.pointerType === "touch";
      const el = e.currentTarget;
      const start = { x: e.clientX, y: e.clientY };
      const pointerId = e.pointerId;
      let active = false;
      let last = start;
      let lastRetarget = 0;
      let frame = 0;
      let timer = 0;

      const activate = () => {
        active = true;
        const r = el.getBoundingClientRect();
        const d: CardDrag = {
          id,
          from,
          to: from,
          overTray: false,
          x: last.x,
          y: last.y,
          grabX: start.x - r.left,
          grabY: start.y - r.top,
          width: r.width,
          height: r.height,
        };
        update(from === null ? retarget(d) : d);
        document.body.style.setProperty("cursor", "grabbing");
        if (touch) {
          touchDragging.current = true;
          navigator.vibrate?.(10);
        }
        frame = requestAnimationFrame(scroll);
      };

      // Scroll near the top and bottom edges, faster the closer it gets.
      const scroll = () => {
        const y = last.y;
        const bottom = window.innerHeight - SCROLL_ZONE_BOTTOM;
        const dy =
          y < SCROLL_ZONE_TOP
            ? -SCROLL_MAX * ((SCROLL_ZONE_TOP - y) / SCROLL_ZONE_TOP)
            : y > bottom
              ? SCROLL_MAX * Math.min(1, (y - bottom) / SCROLL_ZONE_BOTTOM)
              : 0;
        if (dy !== 0) {
          window.scrollBy(0, dy);
          const d = dragRef.current;
          if (d) update(retarget(d));
        }
        frame = requestAnimationFrame(scroll);
      };

      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        last = { x: ev.clientX, y: ev.clientY };
        if (!active) {
          const moved = Math.hypot(last.x - start.x, last.y - start.y);
          if (touch) {
            // Moving before the long press fires is a scroll, not a drag.
            if (moved > TOUCH_SLOP) end();
          } else if (moved > MOUSE_SLOP) {
            activate();
          }
          return;
        }
        const d = dragRef.current;
        if (!d) return;
        const now = performance.now();
        const moved = { ...d, x: last.x, y: last.y };
        if (now - lastRetarget < RETARGET_MS) {
          update(moved);
          return;
        }
        lastRetarget = now;
        update(retarget(moved));
      };

      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        // Where it is now, not where the last (throttled) retarget left it.
        const d = dragRef.current && retarget({ ...dragRef.current, x: ev.clientX, y: ev.clientY });
        end();
        if (!active || !d) return;
        suppressClick.current = true;
        // A click may not follow (the card moved out from under it).
        window.setTimeout(() => (suppressClick.current = false), 0);
        const { onMove, onHide, onPlace } = callbacks.current;
        if (d.overTray) {
          if (d.from !== null) onHide(d.id);
        } else if (d.from === null) {
          if (d.to !== null) onPlace(d.id, d.to);
        } else if (d.to !== null && d.to !== d.from) {
          onMove(d.id, d.from, d.to);
        }
      };

      const key = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape" || !active) return;
        ev.preventDefault();
        ev.stopPropagation();
        end();
      };

      const end = () => {
        window.clearTimeout(timer);
        cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", end);
        window.removeEventListener("keydown", key, true);
        touchDragging.current = false;
        document.body.style.removeProperty("cursor");
        cleanupRef.current = null;
        update(null);
      };

      cleanupRef.current?.();
      cleanupRef.current = end;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", end);
      // Capture phase, ahead of the editor's Escape (which would leave edit
      // mode).
      window.addEventListener("keydown", key, true);
      if (touch) timer = window.setTimeout(activate, LONG_PRESS_MS);
    },
    [retarget, update]
  );

  // For the card's click handler: whether this click ends a drag (and so
  // should be ignored).
  const clickEndsDrag = useCallback(() => {
    const was = suppressClick.current;
    suppressClick.current = false;
    return was;
  }, []);

  return { drag, begin, clickEndsDrag };
}
