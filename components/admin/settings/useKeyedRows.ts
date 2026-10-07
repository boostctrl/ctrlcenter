"use client";

import { useState } from "react";
import { newThemeId } from "@/lib/prefs";
import { reorder } from "../useReorder";

// Stable React keys for editable rows whose stored shape has no id (custom
// bangs, countdown dates — the persisted schema stays id-free on purpose).
// Index keys mis-attach focus/IME state when a middle row is removed, so add
// and removeAt update the items and their keys in one call — the pairing
// can't be forgotten at a call site. In-place edits keep row identity. Keys
// come from newThemeId(), not crypto.randomUUID directly: plain-HTTP LAN
// hosting is a non-secure context, where randomUUID doesn't exist.
//
// `setItems` takes an UPDATER, not a concrete array, and add/removeAt/move
// compose off `prev` rather than the render-captured `items`. React batches
// several mutations that land in one tick (clicking "+ Add" a few times faster
// than a repaint to line up rows), and a snapshot-based add would then compute
// every new array from the same pre-batch list — so all but the last collapse
// and rows silently vanish. The updater form composes each mutation on the
// latest state, and keeps the parallel `keys` in lockstep. `items` is still
// read for `move`'s bounds check (a discrete click, never batched).
export function useKeyedRows<T>(
  items: T[],
  setItems: (update: (prev: T[]) => T[]) => void
) {
  const [keys, setKeys] = useState<string[]>(() =>
    Array.from({ length: items.length }, () => newThemeId())
  );
  return {
    keys,
    add: (item: T) => {
      setItems((prev) => [...prev, item]);
      setKeys((k) => [...k, newThemeId()]);
    },
    removeAt: (i: number) => {
      setItems((prev) => prev.filter((_, idx) => idx !== i));
      setKeys((k) => k.filter((_, idx) => idx !== i));
    },
    // Reorder items and their keys together so a moved row keeps its identity
    // (focus/IME) instead of the value sliding under a stale key.
    move: (from: number, to: number) => {
      if (from === to || to < 0 || to >= items.length) return;
      setItems((prev) => reorder(prev, from, to));
      setKeys((k) => reorder(k, from, to));
    },
  };
}
