"use client";

// Undo and redo for the layout editor (#314), grouped by gesture rather than
// by time:
// - A pointer gesture (a resize drag, a held stepper) is one step. Its owner
//   brackets it with beginGesture/endGesture, and every change in between
//   folds into the step its first change opened, however long it pauses.
// - Repeats from the keyboard on one continuous control (a slider handle, a
//   stepper button; marked `data-undo-merge`) fold together while focus stays
//   on that control. A control doing several things (a selected card: arrows
//   move it, Shift+arrows resize it) names the kind of the next change with
//   group(key) instead, and only changes of one kind fold.
// - Every other change is its own step, so Show, Hide, Fill or a move right
//   after a resize can be undone on its own.
// A new step clears the redo stack. The stacks are bounded; the oldest steps
// fall off.
import { createContext, useCallback, useContext, useRef, useState } from "react";

export const UNDO_LIMIT = 50;

// Where a change came from, when it's one whose keyboard repeats merge: the
// focused control, and the kind of change (`pending` from group(), else the
// control's own mark).
type MergeSource = { el: Element | null; key: string };
function mergeSource(pending: string | null): MergeSource | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  if (pending !== null) return { el, key: pending };
  return el instanceof HTMLElement && el.dataset.undoMerge !== undefined ? { el, key: "" } : null;
}

export function useUndoHistory<T>() {
  const undoRef = useRef<T[]>([]);
  const redoRef = useRef<T[]>([]);
  // The open pointer gesture, and whether it has opened its step yet.
  const gestureRef = useRef<{ recorded: boolean } | null>(null);
  // Where the last change came from, and the kind named for the next one.
  const lastControlRef = useRef<MergeSource | null>(null);
  const pendingKeyRef = useRef<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const sync = useCallback(() => {
    setCanUndo(undoRef.current.length > 0);
    setCanRedo(redoRef.current.length > 0);
  }, []);

  // Call before applying a change, with the value it replaces. Opens a new
  // step unless the change belongs to the one in progress.
  const record = useCallback(
    (before: T) => {
      const gesture = gestureRef.current;
      let open: boolean;
      if (gesture) {
        open = !gesture.recorded;
        gesture.recorded = true;
      } else {
        const source = mergeSource(pendingKeyRef.current);
        const last = lastControlRef.current;
        open = source === null || last === null || source.el !== last.el || source.key !== last.key;
        lastControlRef.current = source;
      }
      pendingKeyRef.current = null;
      if (!open) return;
      undoRef.current.push(before);
      if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
      redoRef.current = [];
      sync();
    },
    [sync]
  );

  // The value to go back to (current goes onto the redo stack), or undefined
  // when there's nothing to undo.
  const undo = useCallback(
    (current: T): T | undefined => {
      const prev = undoRef.current.pop();
      if (prev === undefined) return undefined;
      redoRef.current.push(current);
      gestureRef.current = null;
      lastControlRef.current = null;
      sync();
      return prev;
    },
    [sync]
  );

  const redo = useCallback(
    (current: T): T | undefined => {
      const next = redoRef.current.pop();
      if (next === undefined) return undefined;
      undoRef.current.push(current);
      gestureRef.current = null;
      lastControlRef.current = null;
      sync();
      return next;
    },
    [sync]
  );

  const beginGesture = useCallback(() => {
    gestureRef.current = { recorded: false };
  }, []);
  // `current` is the value the gesture ended on: one that ends where it
  // began (a drag out and back) leaves no step behind.
  const endGesture = useCallback(
    (current?: T) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      lastControlRef.current = null;
      const top = undoRef.current.at(-1);
      if (gesture?.recorded && current !== undefined && top !== undefined && JSON.stringify(top) === JSON.stringify(current)) {
        undoRef.current.pop();
        sync();
      }
    },
    [sync]
  );
  // Name the kind of the next change, so keyboard repeats of that kind on the
  // focused control fold together.
  const group = useCallback((key: string) => {
    pendingKeyRef.current = key;
  }, []);

  // Forget everything (leaving edit mode).
  const clear = useCallback(() => {
    undoRef.current = [];
    redoRef.current = [];
    gestureRef.current = null;
    lastControlRef.current = null;
    sync();
  }, [sync]);

  return { record, undo, redo, beginGesture, endGesture, group, clear, canUndo, canRedo };
}

// How a control deep in the editor brackets a pointer gesture so it lands as
// one undo step. A no-op outside the editor.
export type UndoGesture = { begin: () => void; end: () => void; group: (key: string) => void };
const noop = () => {};
export const UndoGestureContext = createContext<UndoGesture>({ begin: noop, end: noop, group: noop });
export const useUndoGesture = () => useContext(UndoGestureContext);
