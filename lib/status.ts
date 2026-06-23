// Shared types + helpers for app reachability checks. The /api/status endpoint
// pings each app URL and returns a StatusResponse; the dashboard dots, the
// dashboard health pill, and the /status page all consume it.

// One app's reachability: `up` is false only on a network error or timeout (a
// reachable host that answers 401/403/5xx still counts as up). `status` is the
// HTTP code when reachable, `ms` the round-trip time.
export type AppStatus = { up: boolean; status: number | null; ms: number };

// A status keyed by the app id it belongs to.
export type StatusResult = AppStatus & { id: string };

// The /api/status payload. `checkedAt` is when the (cached) results were
// produced, so clients can show an accurate "last checked" time.
export type StatusResponse = { checkedAt: number; results: StatusResult[] };

export type StatusSummary = {
  up: number;
  down: number;
  total: number;
  allUp: boolean;
};

// Roll a set of per-app results up into overall counts for the summary banner
// and dashboard pill. Takes anything carrying an `up` flag. Empty input is
// treated as "nothing to report" (not all up), so a pre-first-poll page doesn't
// flash "all systems operational".
export function summarize(results: { up: boolean }[]): StatusSummary {
  const total = results.length;
  const up = results.filter((r) => r.up).length;
  const down = total - up;
  return { up, down, total, allUp: total > 0 && down === 0 };
}

// Whether an HTTP status code satisfies an app's `expectStatus` spec — a comma
// list of codes and inclusive ranges, e.g. "200-299, 301, 401". An empty/blank
// spec matches anything (any reachable host counts as up).
export function matchesStatus(code: number, spec: string): boolean {
  const trimmed = spec.trim();
  if (!trimmed) return true;
  return trimmed.split(",").some((tokenRaw) => {
    const token = tokenRaw.trim();
    if (!token) return false;
    const range = /^(\d{3})\s*-\s*(\d{3})$/.exec(token);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      return code >= Math.min(lo, hi) && code <= Math.max(lo, hi);
    }
    return /^\d{3}$/.test(token) && Number(token) === code;
  });
}

// --- Uptime history (the background poller + /api/status/history) ---

// Uptime percentage (0–100) over a window, or null when there's no data for it.
export type UptimeWindows = {
  d1: number | null;
  d7: number | null;
  d30: number | null;
  d90: number | null;
};

// One day in the timeline: uptime % for that day, or null if nothing was
// recorded (e.g. the server was off, or before this app existed).
export type TimelinePoint = { date: string; uptime: number | null };

export type AppHistory = {
  id: string;
  uptime: UptimeWindows;
  timeline: TimelinePoint[];
};

// The /api/status/history payload.
export type StatusHistory = { generatedAt: number; apps: AppHistory[] };
