"use client";

// Undo and redo for the layout editor (#314), grouped by gesture rather than
// by time:
// - A pointer gesture (a resize drag, a held stepper) is one step. Its owner
//   brackets it with beginGesture/endGesture, and every change in between
//   folds into the step its first change opened, however long it pauses.
// - Repeats from the keyboard on one continuous control (a slider handle, a
//   stepper button; marked `data-undo-merge`) fold together while focus stays
//   on that control.
// - Every other change is its own step, so Show, Hide, Fill or a move right
//   after a resize can be undone on its own.
// A new step clears the redo stack. The stacks are bounded; the oldest steps
// fall off.
import { createContext, useCallback, useContext, useRef, useState } from "react";

export const UNDO_LIMIT = 50;

// The control a change came from, when it's one whose keyboard repeats merge.
function mergeControl(): Element | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  return el instanceof HTMLElement && el.dataset.undoMerge !== undefined ? el : null;
}

export function useUndoHistory<T>() {
  const undoRef = useRef<T[]>([]);
  const redoRef = useRef<T[]>([]);
  // The open pointer gesture, and whether it has opened its step yet.
  const gestureRef = useRef<{ recorded: boolean } | null>(null);
  // The merge control the last change came from.
  const lastControlRef = useRef<Element | null>(null);
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
        const control = mergeControl();
        open = control === null || control !== lastControlRef.current;
        lastControlRef.current = control;
      }
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
  const endGesture = useCallback(() => {
    gestureRef.current = null;
    lastControlRef.current = null;
  }, []);

  // Forget everything (leaving edit mode).
  const clear = useCallback(() => {
    undoRef.current = [];
    redoRef.current = [];
    gestureRef.current = null;
    lastControlRef.current = null;
    sync();
  }, [sync]);

  return { record, undo, redo, beginGesture, endGesture, clear, canUndo, canRedo };
}

// How a control deep in the editor brackets a pointer gesture so it lands as
// one undo step. A no-op outside the editor.
export type UndoGesture = { begin: () => void; end: () => void };
const noop = () => {};
export const UndoGestureContext = createContext<UndoGesture>({ begin: noop, end: noop });
export const useUndoGesture = () => useContext(UndoGestureContext);
