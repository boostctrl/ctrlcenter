"use client";

import { useEffect, useState } from "react";

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

// The violet insertion line for the row currently hovered during a drag: on its
// top edge when the drop lands above the row, bottom edge when below. Empty for
// every other row, including the one being dragged. Factored out because three
// lists (apps, bookmarks within a category, and the category headings) draw the
// same indicator. Pure, so it's unit-tested.
export function dropIndicatorClass(
  index: number,
  state: {
    dragIndex: number | null;
    overIndex: number | null;
    dropEdge: DropEdge | null;
  }
): string {
  if (state.overIndex !== index || state.dragIndex === index) return "";
  if (state.dropEdge === "top") return "border-t-2 border-t-violet-400";
  if (state.dropEdge === "bottom") return "border-b-2 border-b-violet-400";
  return "";
}

// Native HTML5 drag-and-drop reordering for a flat list. The component spreads
// `handlers(index)` onto each row and `grip(index)` onto that row's drag handle
// (e.g. a ⠿ grip), then uses `dragIndex`/`overIndex`/`dropEdge` for visual
// feedback. On a successful drop, `onCommit` receives the reordered array (the
// caller persists it).
//
// A row is draggable only while the pointer is held down on its grip, so
// selecting/copying text elsewhere in the row still works (dragging the whole
// row would hijack text selection — the admin cousin of #99). The grip arms the
// row on mousedown; a window mouseup (a plain click that never became a drag) or
// the drag ending disarms it, so a click never leaves a row permanently
// draggable.
//
// Drag-and-drop is mouse-only, so `move(from, to)` is also exposed for the
// keyboard- and touch-accessible up/down buttons that wrap it.
export function useReorder<T>(items: T[], onCommit: (next: T[]) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [armedIndex, setArmedIndex] = useState<number | null>(null);

  // Disarm on the next window mouseup so a plain click on the grip (mousedown
  // then mouseup with no drag) doesn't leave the row draggable. A real drag
  // clears it via onDragEnd instead, since a native drag may not fire mouseup.
  useEffect(() => {
    if (armedIndex === null) return;
    const disarm = () => setArmedIndex(null);
    window.addEventListener("mouseup", disarm);
    return () => window.removeEventListener("mouseup", disarm);
  }, [armedIndex]);

  function reset() {
    setDragIndex(null);
    setOverIndex(null);
    setArmedIndex(null);
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
      draggable: armedIndex === index,
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

  // Spread onto the row's drag handle (the ⠿ grip). Holding the pointer down
  // here arms this row so the following pointer movement starts a native drag,
  // while leaving the rest of the row selectable.
  function grip(index: number) {
    return { onMouseDown: () => setArmedIndex(index) };
  }

  return { handlers, grip, dragIndex, overIndex, dropEdge, move };
}
