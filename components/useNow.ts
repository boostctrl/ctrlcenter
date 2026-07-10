"use client";

import { useEffect, useState } from "react";

// The current time as state, re-read every `intervalMs`. For components whose
// render depends on "now" (announcement Active/Scheduled flips, state chips)
// without each of them hand-rolling the same setInterval effect — and so
// Date.now() isn't called impurely during render.
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
