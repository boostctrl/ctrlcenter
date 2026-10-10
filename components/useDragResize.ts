"use client";

import { useRef, useState } from "react";
import { useUndoGesture } from "./useUndoHistory";
import {
  GRID_COLUMNS,
  MIN_WIDGET_HEIGHT,
  MAX_WIDGET_HEIGHT,
  WIDGET_HEIGHT_STEP,
} from "@/lib/layout";

// Direct-manipulation resize for a widget cell in the layout editor (#312):
// the right edge drags the column span, the bottom edge the height, and the
// bottom-right corner both. Pointer-based (mouse/pen/touch); the steppers and
// the arrow keys remain the keyboard/precise path. Start values are captured
// on pointerdown and the pointer is captured, so a re-render mid-drag (each
// onSpan/onHeight fires one) never drops the gesture. One drag is one undo
// step, and the autosave waits for it to end (#314).
//
// A height drag snaps to the stepper's step, and back to automatic when it
// comes near the content's own height — the way out of an explicit height
// that used to need the Auto button.

export type ResizeKind = "width" | "height" | "corner";
export type ResizeDrag = {
  kind: ResizeKind;
  span: number;
  // undefined = automatic.
  height: number | undefined;
  // The pointer, for the value badge that follows it.
  x: number;
  y: number;
  // For the column guides: the first column the card starts in, and the
  // grid's left edge, width and column gap on screen.
  startColumn: number;
  grid: { left: number; width: number; gap: number };
} | null;

// How close to the content's own height snaps back to automatic.
export const AUTO_SNAP_PX = 12;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// The height a drag lands on: within AUTO_SNAP_PX of the content's own
// height is automatic, otherwise the nearest step, inside the range.
export function snapHeight(raw: number, natural: number): number | undefined {
  if (Math.abs(raw - natural) <= AUTO_SNAP_PX) return undefined;
  return clamp(Math.round(raw / WIDGET_HEIGHT_STEP) * WIDGET_HEIGHT_STEP, MIN_WIDGET_HEIGHT, MAX_WIDGET_HEIGHT);
}

// The content's own height, measured by lifting the explicit height for a
// moment (synchronously, so nothing paints in between).
function naturalHeight(el: HTMLElement): number {
  const height = el.style.height;
  const variable = el.style.getPropertyValue("--widget-height");
  el.style.height = "";
  el.style.removeProperty("--widget-height");
  const natural = el.getBoundingClientRect().height;
  el.style.height = height;
  if (variable) el.style.setProperty("--widget-height", variable);
  return natural;
}

export function useDragResize({
  span,
  height,
  onSpan,
  onHeight,
}: {
  span: number;
  height: number | undefined;
  onSpan: (span: number) => void;
  onHeight: (height: number | undefined) => void;
}) {
  // The cell's root (its parent is the grid — used to size a column) and the
  // live preview (measured for the content's own height).
  const frameRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<ResizeDrag>(null);
  const gesture = useUndoGesture();

  function begin(kind: ResizeKind, e: React.PointerEvent<HTMLElement>) {
    const frame = frameRef.current;
    const grid = frame?.parentElement;
    const preview = previewRef.current;
    if (!frame || !grid || !preview || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);
    const colGap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    const gridRect = grid.getBoundingClientRect();
    // Stride = one column plus one gap, so a full-width drag walks all 24.
    const stride = (gridRect.width - (GRID_COLUMNS - 1) * colGap) / GRID_COLUMNS + colGap || 1;
    const startColumn = clamp(Math.round((frame.getBoundingClientRect().left - gridRect.left) / stride), 0, GRID_COLUMNS - 1);
    const natural = naturalHeight(preview);
    const startHeight = clamp(height ?? natural, MIN_WIDGET_HEIGHT, MAX_WIDGET_HEIGHT);
    const gridBox = { left: gridRect.left, width: gridRect.width, gap: colGap };
    const startX = e.clientX;
    const startY = e.clientY;
    let curSpan = span;
    let curHeight = height;

    const move = (ev: PointerEvent) => {
      if (kind !== "height") {
        const next = clamp(span + Math.round((ev.clientX - startX) / stride), 1, GRID_COLUMNS);
        if (next !== curSpan) {
          curSpan = next;
          onSpan(next);
        }
      }
      if (kind !== "width") {
        const next = snapHeight(startHeight + (ev.clientY - startY), natural);
        if (next !== curHeight) {
          curHeight = next;
          onHeight(next);
        }
      }
      setDrag({ kind, span: curSpan, height: curHeight, x: ev.clientX, y: ev.clientY, startColumn, grid: gridBox });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setDrag(null);
      gesture.end();
    };
    gesture.begin();
    setDrag({ kind, span, height, x: e.clientX, y: e.clientY, startColumn, grid: gridBox });
    // The pointer is captured by the handle, so its events keep coming here
    // wherever the pointer goes.
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  return {
    frameRef,
    previewRef,
    drag,
    widthHandle: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => begin("width", e) },
    heightHandle: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => begin("height", e) },
    cornerHandle: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => begin("corner", e) },
  };
}
