"use client";

import { useEffect, useState } from "react";

// The current time as state, re-read every `intervalMs`. For components whose
// render depends on "now" (announcement Active/Scheduled flips, state chips,
// "updated 20s ago" labels) without each of them hand-rolling the same
// setInterval effect — and so Date.now() isn't called impurely during render.
// Pauses while the tab is hidden and catches up the moment it's shown again.
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(id);
      id = setInterval(() => setNow(Date.now()), intervalMs);
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(id);
        return;
      }
      setNow(Date.now());
      start();
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
  return now;
}
