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

// The ways an app's reachability can be checked. `http` (and `keyword`, which
// also matches the response body) speak HTTP and honour `expectStatus`; `tcp`,
// `dns`, and `icmp` derive their target host from the app URL. Shared so the
// schema enum, the checker, and the admin picker stay in sync.
export const CHECK_TYPES = [
  { key: "http", label: "HTTP" },
  { key: "tcp", label: "TCP port" },
  { key: "keyword", label: "Keyword" },
  { key: "dns", label: "DNS" },
  { key: "icmp", label: "Ping (ICMP)" },
] as const;
export type CheckType = (typeof CHECK_TYPES)[number]["key"];
export const CHECK_TYPE_KEYS = CHECK_TYPES.map((c) => c.key) as [
  CheckType,
  ...CheckType[],
];

// --- Uptime history (the background poller + /api/status/history) ---

// Uptime percentage (0–100) over a window, or null when there's no data for it.
export type UptimeWindows = {
  h1: number | null;
  d1: number | null;
  d7: number | null;
  d30: number | null;
  d90: number | null;
};

// The time ranges offered by the /status page toggle (and the admin-configurable
// default). Keys map to UptimeWindows fields. Shared so the toggle, the schema
// enum, and the admin picker stay in sync.
export const STATUS_RANGES = [
  { key: "h1", label: "1h" },
  { key: "d1", label: "24h" },
  { key: "d30", label: "30d" },
  { key: "d90", label: "90d" },
] as const;
export type StatusRangeKey = (typeof STATUS_RANGES)[number]["key"];
export const STATUS_RANGE_KEYS = STATUS_RANGES.map((r) => r.key) as [
  StatusRangeKey,
  ...StatusRangeKey[],
];

// Every timeline renders this many bars, whatever the range: the server buckets
// each range's window into the same fixed count so all four views draw an
// identically-sized heartbeat strip instead of a different length (and pill
// size) per range. The pills are flex-1 within a fixed-width strip, so this
// count sets how many/how wide the pills are without changing the strip's
// footprint — fewer, wider pills read more cleanly than a dense comb.
export const TIMELINE_BARS = 30;

// One bar in a timeline: uptime % for that bucket, or null if nothing was
// recorded (server off, or before this app existed). `at` is `YYYY-MM-DD` for a
// daily bar, `YYYY-MM-DDThh` for an hourly one, or `YYYY-MM-DDThh:mm` for a
// single recent poll. All three are UTC instants (produced via toISOString).
export type BarPoint = { at: string; uptime: number | null };

// Format a BarPoint's `at` for the timeline tooltip in the visitor's time zone,
// so the status page reads in the same zone as the rest of the app instead of
// UTC. The minute/hour bars are real instants and are converted to local time; a
// daily bar is a UTC calendar date and is shown as-is (converting it would
// mislabel the bucket). Falls back to UTC if the zone is invalid.
export function formatBarLabel(at: string, timeZone: string): string {
  const fmt = (instant: Date, opts: Intl.DateTimeFormatOptions, tz = timeZone) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(instant);
    } catch {
      return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(instant);
    }
  };
  // Single poll: `YYYY-MM-DDThh:mm` → local date + time.
  if (at.length >= 16) {
    return fmt(new Date(`${at}:00Z`), {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
    });
  }
  // Hourly bucket: `YYYY-MM-DDThh` → local date + hour.
  if (at.includes("T")) {
    return fmt(new Date(`${at}:00:00Z`), {
      month: "short", day: "numeric", hour: "numeric", hour12: true,
    });
  }
  // Daily bucket: a UTC calendar date — prettify it without shifting the zone.
  return fmt(new Date(`${at}T00:00:00Z`), { month: "short", day: "numeric" }, "UTC");
}

export type AppHistory = {
  id: string;
  uptime: UptimeWindows;
  // One fixed-length bar strip per range (each TIMELINE_BARS long), so switching
  // ranges swaps the data under a strip that keeps its size. Built server-side
  // by resampling the raw ring (1h) or the hourly buckets (24h/30d/90d) into
  // equal time buckets — see fixedBars* in status-history.ts.
  series: Record<StatusRangeKey, BarPoint[]>;
};

// The /api/status/history payload.
export type StatusHistory = { generatedAt: number; apps: AppHistory[] };

// The summary line for the status banner / dashboard pill. Names the single down
// service; collapses to "Multiple services down" beyond one.
export function statusMessage(downNames: string[], total: number): string {
  if (total === 0) return "Checking services…";
  if (downNames.length === 0) return "All systems operational";
  if (downNames.length === 1) return `${downNames[0]} is down`;
  return "Multiple services down";
}
