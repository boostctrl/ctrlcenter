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
