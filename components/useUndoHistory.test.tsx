import { describe, it, expect, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { UNDO_LIMIT, useUndoHistory } from "./useUndoHistory";

// Undo grouped by gesture, not by time, plus redo (#314).
function setup() {
  const { result } = renderHook(() => useUndoHistory<number>());
  // A tiny value under edit, changed through the history like the editor does.
  let value = 0;
  const change = (next: number) => {
    act(() => result.current.record(value));
    value = next;
  };
  const undo = () => act(() => {
    const prev = result.current.undo(value);
    if (prev !== undefined) value = prev;
  });
  const redo = () => act(() => {
    const next = result.current.redo(value);
    if (next !== undefined) value = next;
  });
  return { result, change, undo, redo, get value() { return value; } };
}

// A focusable control, optionally one whose keyboard repeats merge.
function control(merge: boolean) {
  const el = document.createElement("button");
  if (merge) el.dataset.undoMerge = "";
  document.body.append(el);
  el.focus();
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useUndoHistory", () => {
  it("makes quick separate changes separate steps", () => {
    const h = setup();
    control(false);
    h.change(1); // Show
    h.change(2); // Hide, a moment later
    h.undo();
    expect(h.value).toBe(1);
    h.undo();
    expect(h.value).toBe(0);
  });

  it("folds a pointer gesture into one step, however long it pauses", () => {
    const h = setup();
    act(() => h.result.current.beginGesture());
    h.change(1);
    h.change(2);
    h.change(3);
    act(() => h.result.current.endGesture());
    h.change(4);
    h.undo();
    expect(h.value).toBe(3);
    h.undo();
    expect(h.value).toBe(0);
  });

  it("merges keyboard repeats only while focus stays on one control", () => {
    const h = setup();
    control(false);
    h.change(1); // Show, from the tray
    control(true);
    h.change(2); // Home on the width handle
    h.change(3); // → → →
    h.change(4);
    h.undo();
    expect(h.value).toBe(1); // the width goes back, the card stays shown
    control(true);
    h.change(5);
    control(true); // another handle
    h.change(6);
    h.undo();
    expect(h.value).toBe(5);
  });

  it("redoes what was undone, until a new change", () => {
    const h = setup();
    h.change(1);
    h.change(2);
    h.undo();
    h.undo();
    expect(h.result.current.canRedo).toBe(true);
    h.redo();
    expect(h.value).toBe(1);
    h.redo();
    expect(h.value).toBe(2);
    expect(h.result.current.canRedo).toBe(false);
    h.undo();
    h.change(9);
    expect(h.result.current.canRedo).toBe(false);
    h.redo();
    expect(h.value).toBe(9);
  });

  it("keeps a bounded stack and clears on request", () => {
    const h = setup();
    for (let i = 1; i <= UNDO_LIMIT + 5; i++) h.change(i);
    for (let i = 0; i < UNDO_LIMIT + 5; i++) h.undo();
    expect(h.value).toBe(5);
    act(() => h.result.current.clear());
    expect(h.result.current.canUndo).toBe(false);
    expect(h.result.current.canRedo).toBe(false);
  });
});
