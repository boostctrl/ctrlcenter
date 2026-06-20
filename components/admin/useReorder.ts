"use client";

import { useState } from "react";

// Native HTML5 drag-and-drop reordering for a flat list. The component spreads
// `handlers(index)` onto each draggable row and uses `dragIndex`/`overIndex`
// for visual feedback. On a successful drop, `onCommit` receives the reordered
// array (the caller persists it).
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
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onCommit(next);
  }

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
        const next = [...items];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(index, 0, moved);
        reset();
        onCommit(next);
      },
    };
  }

  return { handlers, dragIndex, overIndex, move };
}
