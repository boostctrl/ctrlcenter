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
  // @deprecated No 7d range exists in the UI; this window is computed and
  // shipped only for API compatibility through 1.9.x and will be removed in
  // 2.0.0. Don't build new consumers on it.
  d7: number | null;
  d30: number | null;
  d90: number | null;
};

// Latency (round-trip `ms`) rolled up over a window. `avg` and `max` are whole
// milliseconds. Only *up* checks contribute — a down check's `ms` is its
// time-to-failure (usually the full request timeout) and would drag the average
// up toward that ceiling, so those samples are dropped when recording (see
// recordResults in status-history.ts).
export type LatencyStat = { avg: number; max: number };

// The same set of windows as UptimeWindows, but for latency; null where a window
// has no up-check samples (server was off, app didn't exist yet, or the app was
// down the whole time). Parallel to UptimeWindows so the /status page reads the
// two with the same range key.
export type LatencyWindows = {
  h1: LatencyStat | null;
  d1: LatencyStat | null;
  // @deprecated Same story as UptimeWindows.d7 — unused by the UI, kept only
  // for API compatibility through 1.9.x, removed in 2.0.0 alongside it.
  d7: LatencyStat | null;
  d30: LatencyStat | null;
  d90: LatencyStat | null;
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

// The window length in milliseconds each range's toggle covers, keyed like
// STATUS_RANGES. It lives beside the ranges on purpose: the /status page reads
// it both to know a range's span and to decide whether an app's history is too
// short to actually back that range's uptime % (the "since …" coverage note in
// StatusPage). Keeping the durations here means the toggle and that annotation
// can never disagree about how long "90d" is.
export const STATUS_RANGE_MS: Record<StatusRangeKey, number> = {
  h1: 60 * 60 * 1000, // 1 hour
  d1: 24 * 60 * 60 * 1000, // 24 hours
  d30: 30 * 24 * 60 * 60 * 1000, // 30 days
  d90: 90 * 24 * 60 * 60 * 1000, // 90 days
};

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
// `ms` is the average up-check latency for that bucket, or null when the bucket
// has no up-check samples (empty, or down the whole time) — see fixedBars* in
// status-history.ts.
export type BarPoint = { at: string; uptime: number | null; ms: number | null };

// Format a BarPoint's `at` for the timeline tooltip in the visitor's time zone,
// so the status page reads in the same zone as the rest of the app instead of
// UTC. The minute/hour bars are real instants and are converted to local time; a
// daily bar is a UTC calendar date and is shown as-is (converting it would
// mislabel the bucket). Falls back to UTC if the zone is invalid.
//
// `spanMs` is the bucket's width: a sub-day bucket spans a real interval (48
// minutes on the 24h view), so passing its width labels the whole RANGE ("Jul
// 7, 5:54 – 6:42 PM") instead of implying an instant. Only the minute-level
// (sub-day) bars honour it; a daily bar is already a whole-day bucket and stays
// a single date whatever `spanMs` says.
export function formatBarLabel(
  at: string,
  timeZone: string,
  spanMs?: number
): string {
  const fmt = (instant: Date, opts: Intl.DateTimeFormatOptions, tz = timeZone) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(instant);
    } catch {
      return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(instant);
    }
  };
  // Single poll: `YYYY-MM-DDThh:mm` → local date + time.
  if (at.length >= 16) {
    const opts: Intl.DateTimeFormatOptions = {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
    };
    const start = new Date(`${at}:00Z`);
    // With a bucket width, show the range it covers. formatRange collapses the
    // shared parts ("Jul 7, 5:54 – 6:42 PM") and expands across a day boundary
    // ("Jul 7, 11:50 PM – Jul 8, 12:20 AM").
    if (spanMs && spanMs > 0) {
      const end = new Date(start.getTime() + spanMs);
      // formatRange separates parts with special spaces (a thin space around the
      // en dash, a narrow no-break space before AM/PM); normalize them to plain
      // spaces so the range tooltip matches the rest of the app's labels (which
      // come from plain .format()).
      const range = (tz: string) =>
        new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts })
          .formatRange(start, end)
          .replace(/[\u2009\u202f\u00a0]/g, " ");
      try {
        return range(timeZone);
      } catch {
        return range("UTC");
      }
    }
    return fmt(start, opts);
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

// Build the timeline strip's screen-reader summary from its bars, so the whole
// heartbeat carries one spoken text alternative (an `aria-label` on the
// `role="img"` strip) instead of thirty silent, mouse-only tooltips — see the
// Timeline in StatusPage. Calls out the strip's worst bucket by the time range
// it spans, reusing formatBarLabel so the callout reads in the visitor's zone
// like every other timeline label. `live` folds the trailing "now" pill's state
// into the summary (the pill is otherwise unannounced) as ", currently up/down".
// The all-empty strip (no bucket has data) is described plainly rather than as a
// fabricated 0%.
//
// `windowPct` is the row's displayed windowed uptime % — pass it so the spoken
// figure matches the number rendered beside the strip exactly. The fallback (a
// plain mean of the data-bearing buckets) weighs every bucket equally whatever
// its sample count, so it can drift a few tenths from the windowed figure and
// a screen-reader user would hear two slightly different numbers for one row.
export function timelineSummary(
  points: BarPoint[],
  timeZone: string,
  range: StatusRangeKey,
  live?: boolean,
  windowPct?: number | null
): string {
  const rangeLabel = STATUS_RANGES.find((r) => r.key === range)?.label ?? "";
  const liveSuffix =
    live == null ? "" : live ? ", currently up" : ", currently down";
  const withData = points.filter(
    (p): p is BarPoint & { uptime: number } => p.uptime != null
  );
  if (withData.length === 0) {
    return `${rangeLabel} uptime timeline: no data yet${liveSuffix}`;
  }
  const avg = withData.reduce((sum, p) => sum + p.uptime, 0) / withData.length;
  const pct = windowPct ?? avg;
  const worst = withData.reduce((w, p) => (p.uptime < w.uptime ? p : w));
  const bucketMs = STATUS_RANGE_MS[range] / TIMELINE_BARS;
  const worstLabel = formatBarLabel(worst.at, timeZone, bucketMs);
  return `${rangeLabel} uptime timeline: ${pct.toFixed(1)}% up, worst ${worstLabel} at ${worst.uptime.toFixed(1)}% up${liveSuffix}`;
}

// Format the instant an app's recorded history actually begins, for the
// "since …" note the /status page shows under a range's uptime % when the data
// doesn't reach back far enough to fill the selected window (see StatusPage). A
// day-scale range wants a calendar day — "Jul 4" — while the 1h range, whose
// whole window is an hour, wants a clock time — "5:04 PM". Formatted in the
// visitor's zone like formatBarLabel, falling back to UTC when the zone is
// invalid.
export function formatSince(
  sinceMs: number,
  timeZone: string,
  range: StatusRangeKey
): string {
  const opts: Intl.DateTimeFormatOptions =
    range === "h1"
      ? { hour: "numeric", minute: "2-digit", hour12: true }
      : { month: "short", day: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).format(
      new Date(sinceMs)
    );
  } catch {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(
      new Date(sinceMs)
    );
  }
}

export type AppHistory = {
  id: string;
  uptime: UptimeWindows;
  // Average/max round-trip latency per window, parallel to `uptime` and keyed
  // the same way, so the /status page reads a range's uptime % and latency with
  // one key. Null per window where there were no up-check samples.
  latency: LatencyWindows;
  // One fixed-length bar strip per range (each TIMELINE_BARS long), so switching
  // ranges swaps the data under a strip that keeps its size. Built server-side
  // by resampling the raw ring (1h) or the hourly buckets (24h/30d/90d) into
  // equal time buckets — see fixedBars* in status-history.ts.
  series: Record<StatusRangeKey, BarPoint[]>;
  // Epoch ms of the app's oldest recorded sample, or null when it has none. It
  // lets the client say how far back the data actually goes when a range asks
  // for a longer window than exists: an app watched five minutes otherwise
  // shows "100.0%" over 90d — a figure typographically identical to one with 90
  // days behind it, claiming a window it doesn't cover. See oldestSampleMs in
  // status-history.ts.
  since: number | null;
  // Epoch ms of the poller-observed start of the app's *current* outage, or null
  // when the app was up at the last poll. The row's live dot and detail come
  // from the on-demand /api/status check while the strip and uptime % come from
  // the background poller, so during an outage the two can contradict each other
  // (a red "Unreachable" beside a still-green strip); this lets the page answer
  // "how long has it been down?" straight from the poller's own view. Marked at
  // the transition into down and held there, so it's the outage's start, not the
  // latest down poll — see recordResults in status-history.ts.
  downSince: number | null;
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
