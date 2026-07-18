"use client";

import { useEffect, useState } from "react";
import type { FeedHealth } from "@/lib/feed";

// Passive per-feed diagnostics for the admin RSS section: what the home
// page's own fetches last saw for each URL ("OK · 12 entries · 3 min ago" /
// "HTTP 500 · 2 h ago"). Complements FeedTest, which probes fresh on demand —
// this answers "which of my feeds broke, and when?" without a click. The map
// only covers URLs the server has actually fetched, so a just-added row shows
// nothing until the home page loads it.

export function useFeedHealth(
  enabled: boolean
): Record<string, FeedHealth> | null {
  const [health, setHealth] = useState<Record<string, FeedHealth> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/feed/health")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.health) setHealth(data.health);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return health;
}

function agoLabel(at: number): string {
  const mins = Math.round((Date.now() - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function FeedHealthBadge({ health }: { health?: FeedHealth }) {
  if (!health) return null;
  return health.ok ? (
    <span className="text-xs text-fg/45">
      OK · {health.count ?? 0} entr{health.count === 1 ? "y" : "ies"} ·{" "}
      {agoLabel(health.at)}
    </span>
  ) : (
    <span className="text-xs text-red-400/90">
      {health.error} · {agoLabel(health.at)}
    </span>
  );
}
