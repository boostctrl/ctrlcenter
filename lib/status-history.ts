import fs from "fs/promises";
import path from "path";
import { TIMELINE_BARS } from "./status";
import type {
  StatusResult,
  StatusHistory,
  BarPoint,
  UptimeWindows,
} from "./status";

// Persisted uptime history for the /status page. The background poller
// (instrumentation.ts) records one up/down tally per app per hour; we keep 90
// days of hourly buckets in memory and flush a compact JSON file alongside
// config.yaml. Aggregation to uptime % / a daily timeline happens at read time.

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const RETENTION_HOURS = 90 * 24;
const RECENT_KEEP_MS = 90 * MIN_MS; // ring of raw readings kept for the 1h view
const RECENT_VIEW_MS = 60 * MIN_MS; // window the 1h view / h1 % actually show
const HISTORY_FILE = "status-history.json";

// --- Pure aggregation helpers (unit-tested) ---

export type Bucket = { hour: number; up: number; down: number };

// Epoch *hour number* for a timestamp (ms).
export function hourOf(ts: number): number {
  return Math.floor(ts / HOUR_MS);
}

// "YYYY-MM-DD" calendar date for an instant (ms), in the given time zone, so the
// daily timeline groups by the visitor's local day rather than the UTC day.
function localDayStr(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// `YYYY-MM-DDThh:mm` for a sub-day bar's `at` (a UTC instant; formatBarLabel
// converts it to the visitor's zone).
function minuteStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16);
}

// One raw reading: timestamp (ms) + whether the app was up.
export type Reading = { t: number; up: boolean };

// Resample raw readings into `bars` equal time buckets over [startMs, endMs),
// oldest → newest, for the 1h view. A reading is a step, not a point: between
// polls the service state is known well enough for display, so each reading
// holds until the next one (capped at `holdMs` so a poller outage still reads
// as a gap). Buckets weight overlapping readings by covered time; a bucket no
// reading reaches is null (empty, not down). Without the hold, any poll
// cadence coarser than the bucket width — the shipped default is 5 min against
// 2-min buckets — rendered an alternating comb of filled and empty pills that
// looked like flapping (#108). Every range uses the same bucket count so the
// strip keeps its size.
export function fixedBarsFromReadings(
  readings: Reading[],
  startMs: number,
  endMs: number,
  bars: number,
  holdMs: number
): BarPoint[] {
  const span = (endMs - startMs) / bars;
  const acc = Array.from({ length: bars }, () => ({ up: 0, total: 0 }));
  // The ring is appended chronologically; sort defensively since the step span
  // of each reading is derived from its successor.
  const sorted = [...readings].sort((a, b) => a.t - b.t);
  for (let k = 0; k < sorted.length; k++) {
    const r = sorted[k];
    const next = sorted[k + 1];
    // The reading covers [r.t, next poll), capped at holdMs; clip to the window.
    // A reading from before the window can still cover its opening buckets.
    const lo = Math.max(r.t, startMs);
    const hi = Math.min(next ? next.t : endMs, r.t + holdMs, endMs);
    if (hi <= lo) continue;
    for (let i = Math.max(0, Math.floor((lo - startMs) / span)); i < bars; i++) {
      const bStart = startMs + i * span;
      if (bStart >= hi) break;
      const overlap = Math.min(bStart + span, hi) - Math.max(bStart, lo);
      if (overlap <= 0) continue;
      acc[i].total += overlap;
      if (r.up) acc[i].up += overlap;
    }
  }
  return acc.map((a, i) => ({
    at: minuteStr(startMs + i * span),
    uptime: a.total === 0 ? null : (a.up / a.total) * 100,
  }));
}

// Resample hourly up/down buckets into `bars` equal time buckets over
// [startMs, endMs), weighting each hour by how much of it overlaps a bucket.
// One rule covers both directions: wide ranges (a bucket spans many hours) sum
// the hours inside it, while a sub-hour bucket takes its covering hour's ratio
// unchanged — so every bucket is filled (no gaps) whatever the range. `atOf`
// stamps each bucket's label instant. Uptime is null where no hour had data.
export function fixedBarsFromBuckets(
  buckets: Bucket[],
  startMs: number,
  endMs: number,
  bars: number,
  atOf: (ms: number) => string
): BarPoint[] {
  const span = (endMs - startMs) / bars;
  const acc = Array.from({ length: bars }, () => ({ up: 0, down: 0 }));
  for (const b of buckets) {
    const hStart = b.hour * HOUR_MS;
    const lo = Math.max(hStart, startMs);
    const hi = Math.min(hStart + HOUR_MS, endMs);
    if (hi <= lo) continue; // hour outside the window
    for (let i = Math.floor((lo - startMs) / span); i < bars; i++) {
      const bStart = startMs + i * span;
      if (bStart >= hi) break;
      const overlap = Math.min(bStart + span, hi) - Math.max(bStart, lo);
      if (overlap <= 0) continue;
      const w = overlap / HOUR_MS;
      acc[i].up += b.up * w;
      acc[i].down += b.down * w;
    }
  }
  return acc.map((a, i) => {
    const total = a.up + a.down;
    return {
      at: atOf(startMs + i * span),
      uptime: total === 0 ? null : (a.up / total) * 100,
    };
  });
}

// Uptime % (0–100) across readings at/after `sinceMs`, or null if none.
export function recentPct(readings: Reading[], sinceMs: number): number | null {
  let up = 0;
  let total = 0;
  for (const r of readings) {
    if (r.t < sinceMs) continue;
    total++;
    if (r.up) up++;
  }
  return total === 0 ? null : (up / total) * 100;
}

// Uptime % (0–100) across buckets at or after `sinceHour`, or null if no samples.
export function uptimePct(buckets: Bucket[], sinceHour: number): number | null {
  let up = 0;
  let total = 0;
  for (const b of buckets) {
    if (b.hour < sinceHour) continue;
    up += b.up;
    total += b.up + b.down;
  }
  return total === 0 ? null : (up / total) * 100;
}

// Day-scale windows from the hourly buckets. `h1` is added at read time from the
// raw recent ring (see getHistory), since the buckets are only hourly.
function dayWindows(
  buckets: Bucket[],
  nowHour: number
): Omit<UptimeWindows, "h1"> {
  return {
    d1: uptimePct(buckets, nowHour - 24),
    d7: uptimePct(buckets, nowHour - 24 * 7),
    d30: uptimePct(buckets, nowHour - 24 * 30),
    d90: uptimePct(buckets, nowHour - 24 * 90),
  };
}

// --- In-memory store + persistence (server-only) ---

type AppBuckets = Map<number, { up: number; down: number }>;
type HistoryState = {
  store: Map<string, AppBuckets>;
  recent: Map<string, Reading[]>; // raw readings (last ~90 min) for the 1h view
  loaded: boolean;
  flushQueue: Promise<unknown>;
};

// Held on globalThis so the background poller (instrumentation.ts) and the API
// route share ONE instance even if Next bundles them into separate module
// graphs — otherwise the reader loads the file once and never sees the poller's
// ongoing writes ("one reading, then frozen").
const g = globalThis as unknown as { __ctrlcenterStatusHistory?: HistoryState };
const state: HistoryState = (g.__ctrlcenterStatusHistory ??= {
  store: new Map(),
  recent: new Map(),
  loaded: false,
  flushQueue: Promise.resolve(),
});
state.recent ??= new Map(); // tolerate a state created by an older build

function historyPath(): string {
  const configPath =
    process.env.CONFIG_PATH || path.join(process.cwd(), "config", "config.yaml");
  return path.join(path.dirname(configPath), HISTORY_FILE);
}

// Load the persisted history into memory once (idempotent). Stored shape:
// { apps: { [id]: { [hour]: [up, down] } }, recent: { [id]: [[t, up?1:0], …] } }.
export async function loadHistory(): Promise<void> {
  if (state.loaded) return;
  state.loaded = true;
  try {
    const raw = await fs.readFile(historyPath(), "utf8");
    const data = JSON.parse(raw);
    const next = new Map<string, AppBuckets>();
    for (const [id, hours] of Object.entries(data?.apps ?? {})) {
      const m: AppBuckets = new Map();
      for (const [hk, v] of Object.entries(hours as Record<string, number[]>)) {
        m.set(Number(hk), { up: v?.[0] ?? 0, down: v?.[1] ?? 0 });
      }
      next.set(id, m);
    }
    state.store = next;
    const recent = new Map<string, Reading[]>();
    const cutoff = Date.now() - RECENT_KEEP_MS;
    for (const [id, rows] of Object.entries(data?.recent ?? {})) {
      const list = (rows as [number, number][])
        .filter((r) => r?.[0] >= cutoff)
        .map((r) => ({ t: r[0], up: r[1] === 1 }));
      if (list.length) recent.set(id, list);
    }
    state.recent = recent;
  } catch {
    state.store = new Map();
    state.recent = new Map();
  }
}

// The most recent raw reading (up/down) per id, for ids that have one in the
// recent ring. The alert poller uses this to seed its state on startup so a
// restart doesn't re-alert an app that was already down. Call it BEFORE
// recordResults so it reflects the prior tick, not the one being recorded.
export function lastReadings(ids: string[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const id of ids) {
    const list = state.recent.get(id);
    if (list && list.length) out.set(id, list[list.length - 1].up);
  }
  return out;
}

// Tally one round of results into the current hour, pruning anything older than
// the retention window.
export function recordResults(results: StatusResult[], at: number): void {
  const hour = hourOf(at);
  const cutoff = hour - RETENTION_HOURS;
  const recentCutoff = at - RECENT_KEEP_MS;
  for (const r of results) {
    let m = state.store.get(r.id);
    if (!m) {
      m = new Map();
      state.store.set(r.id, m);
    }
    const b = m.get(hour) ?? { up: 0, down: 0 };
    if (r.up) b.up++;
    else b.down++;
    m.set(hour, b);
    for (const k of m.keys()) if (k < cutoff) m.delete(k);

    // Raw ring for the 1h view, pruned to the keep window.
    const list = state.recent.get(r.id) ?? [];
    list.push({ t: at, up: r.up });
    state.recent.set(
      r.id,
      list.filter((x) => x.t >= recentCutoff)
    );
  }
}

// Serialized, atomic write of the in-memory store to disk (temp file + rename so
// a concurrent read never sees a torn JSON file).
export function flush(): Promise<void> {
  state.flushQueue = state.flushQueue.then(async () => {
    const apps: Record<string, Record<number, [number, number]>> = {};
    for (const [id, m] of state.store) {
      const hours: Record<number, [number, number]> = {};
      for (const [hk, b] of m) hours[hk] = [b.up, b.down];
      apps[id] = hours;
    }
    const recent: Record<string, [number, number][]> = {};
    for (const [id, list] of state.recent) {
      if (list.length) recent[id] = list.map((r) => [r.t, r.up ? 1 : 0]);
    }
    const file = historyPath();
    const tmp = `${file}.tmp`;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify({ apps, recent }), "utf8");
      await fs.rename(tmp, file);
    } catch {
      // best-effort; history is non-critical
    }
  });
  return state.flushQueue as Promise<void>;
}

// Read history for the given app ids (preserving order) as the API payload:
// uptime windows (h1 from the raw ring, the rest from the hourly buckets) plus
// one fixed-length bar strip per range. Every strip is TIMELINE_BARS long — the
// 1h view resamples the raw ring, the day-scale views resample the hourly
// buckets — so all four ranges draw an identically-sized heartbeat. The day
// labels use `timeZone`'s calendar date; defaults to UTC when no zone is given.
// `intervalMinutes` is the poller cadence: a 1h reading holds for up to twice
// that, so normal polling paints a continuous strip while a stalled poller
// still shows a gap.
export function getHistory(
  ids: string[],
  timeZone = "UTC",
  intervalMinutes = 5
): StatusHistory {
  const now = Date.now();
  const nowHour = hourOf(now);
  const recentSince = now - RECENT_VIEW_MS;
  const holdMs = 2 * intervalMinutes * MIN_MS;
  const dayAt = (ms: number) => localDayStr(ms, timeZone);
  const apps = ids.map((id) => {
    const m = state.store.get(id);
    const buckets: Bucket[] = m
      ? [...m].map(([hour, b]) => ({ hour, up: b.up, down: b.down }))
      : [];
    const readings = state.recent.get(id) ?? [];
    return {
      id,
      uptime: {
        h1: recentPct(readings, recentSince),
        ...dayWindows(buckets, nowHour),
      },
      series: {
        h1: fixedBarsFromReadings(readings, recentSince, now, TIMELINE_BARS, holdMs),
        d1: fixedBarsFromBuckets(buckets, now - DAY_MS, now, TIMELINE_BARS, minuteStr),
        d30: fixedBarsFromBuckets(buckets, now - 30 * DAY_MS, now, TIMELINE_BARS, dayAt),
        d90: fixedBarsFromBuckets(buckets, now - 90 * DAY_MS, now, TIMELINE_BARS, dayAt),
      },
    };
  });
  return { generatedAt: Date.now(), apps };
}
