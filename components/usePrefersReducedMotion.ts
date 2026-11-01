"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function query(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null;
}

function subscribe(onChange: () => void): () => void {
  const mq = query();
  if (!mq || typeof mq.addEventListener !== "function") return () => {};
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const getSnapshot = () => query()?.matches ?? false;
const getServerSnapshot = () => false;

// The OS reduced-motion preference, live. A canvas effect (the scenes, the
// weather hero) runs its animation loop from an effect, so taking this as a
// dependency re-runs that effect when the setting changes while the page is
// open — a still frame at once, or motion again — as the CSS animations'
// media query does on its own (#395). False on the server.
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
