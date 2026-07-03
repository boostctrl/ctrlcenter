"use client";

import { useRef, useState } from "react";
import {
  GRID_COLUMNS,
  MIN_WIDGET_HEIGHT,
  MAX_WIDGET_HEIGHT,
  DEFAULT_WIDGET_HEIGHT,
} from "@/lib/layout";

// Direct-manipulation resize for a widget cell in the layout editor: a handle on
// the right edge drags the column span, one on the bottom edge drags the height.
// Pointer-based (mouse/pen/touch); the steppers remain the keyboard/precise path,
// the same split as useFlowReorder ↔ MoveButtons. Start values are captured on
// pointerdown and the move/up listeners live on the window, so a re-render
// mid-drag (each onSpan/onHeight fires one) never drops the gesture.

export type ResizeDrag = { kind: "width" | "height"; value: number } | null;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function useDragResize({
  span,
  height,
  onSpan,
  onHeight,
}: {
  span: number;
  height: number | undefined;
  onSpan: (span: number) => void;
  onHeight: (height: number) => void;
}) {
  // The cell's root (its parent is the grid — used to size a column) and the
  // live preview (measured to seed a height drag that starts from "Auto").
  const frameRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<ResizeDrag>(null);

  function beginWidth(e: React.PointerEvent) {
    const grid = frameRef.current?.parentElement;
    if (!grid) return;
    e.preventDefault();
    e.stopPropagation();
    const colGap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    // Stride = one column plus one gap, so a full-width drag walks all 24.
    const stride =
      (grid.clientWidth - (GRID_COLUMNS - 1) * colGap) / GRID_COLUMNS + colGap;
    const startX = e.clientX;
    const startSpan = span;
    let latest = startSpan;
    const move = (ev: PointerEvent) => {
      const next = clamp(
        startSpan + Math.round((ev.clientX - startX) / (stride || 1)),
        1,
        GRID_COLUMNS
      );
      setDrag({ kind: "width", value: next });
      if (next !== latest) {
        latest = next;
        onSpan(next);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function beginHeight(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const measured = previewRef.current
      ? Math.round(previewRef.current.getBoundingClientRect().height)
      : DEFAULT_WIDGET_HEIGHT;
    const startHeight = clamp(
      height ?? measured,
      MIN_WIDGET_HEIGHT,
      MAX_WIDGET_HEIGHT
    );
    const startY = e.clientY;
    let latest = height;
    const move = (ev: PointerEvent) => {
      const next = clamp(
        Math.round(startHeight + (ev.clientY - startY)),
        MIN_WIDGET_HEIGHT,
        MAX_WIDGET_HEIGHT
      );
      setDrag({ kind: "height", value: next });
      if (next !== latest) {
        latest = next;
        onHeight(next);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return {
    frameRef,
    previewRef,
    drag,
    widthHandle: { onPointerDown: beginWidth },
    heightHandle: { onPointerDown: beginHeight },
  };
}
