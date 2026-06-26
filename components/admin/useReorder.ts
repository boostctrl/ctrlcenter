"use client";

import { useState } from "react";

// Move the item at `from` to `to`, returning a new array (the original is left
// untouched). Shared by drag-and-drop and the up/down buttons so both reorder
// identically. The dropped item ends up at index `to`.
export function reorder<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// Which edge of the hovered row to draw the insertion line on.
export type DropEdge = "top" | "bottom";

// Native HTML5 drag-and-drop reordering for a flat list. The component spreads
// `handlers(index)` onto each draggable row and uses `dragIndex`/`overIndex`/
// `dropEdge` for visual feedback. On a successful drop, `onCommit` receives the
// reordered array (the caller persists it).
//
// Drag-and-drop is mouse-only, so `move(from, to)` is also exposed for the
// keyboard- and touch-accessible up/down buttons that wrap it.
export function useReorder<T>(items: T[], onCommit: (next: T[]) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function reset() {
    setDragIndex(null);
    setOverIndex(null);
  }

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= items.length) return;
    onCommit(reorder(items, from, to));
  }

  // The dropped item lands AT the hovered row's index, so relative to that row it
  // ends up just below it when dragging downward and just above it when dragging
  // up. Expose that as the edge to draw the insertion line on, so the indicator
  // points to where the drop actually lands instead of a whole-row highlight that
  // reads as off-by-one.
  const dropEdge: DropEdge | null =
    dragIndex === null || overIndex === null || dragIndex === overIndex
      ? null
      : dragIndex < overIndex
        ? "bottom"
        : "top";

  function handlers(index: number) {
    return {
      draggable: true,
      onDragStart: () => setDragIndex(index),
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        if (index !== overIndex) setOverIndex(index);
      },
      onDragEnd: reset,
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (dragIndex === null || dragIndex === index) {
          reset();
          return;
        }
        const next = reorder(items, dragIndex, index);
        reset();
        onCommit(next);
      },
    };
  }

  return { handlers, dragIndex, overIndex, dropEdge, move };
}
