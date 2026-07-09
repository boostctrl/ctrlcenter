import fs from "fs/promises";
import path from "path";
import { TIMELINE_BARS } from "./status";
import type {
  StatusResult,
  StatusHistory,
  BarPoint,
  UptimeWindows,
  LatencyStat,
  LatencyWindows,
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

// One hour's tally for one app. `up`/`down` count checks; the three `ms*` fields
// are the latency accumulators (average = msSum / msCount, plus a running max).
// `msCount` is tracked separately rather than reused from `up` on purpose:
// buckets recorded before this feature shipped carry an `up` tally but zero
// latency samples, so dividing `msSum` by `up` would divide by checks that never
// contributed and understate the average across the upgrade boundary. Only up
// checks feed the latency accumulators (see recordResults), so on fully-recorded
// hours msCount == up anyway.
export type Bucket = {
  hour: number;
  up: number;
  down: number;
  msCount: number;
  msSum: number;
  msMax: number;
};

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

// One raw reading: timestamp (ms) + whether the app was up. `ms` is the
// round-trip latency, stamped on up readings only (a down reading's ms is
// time-to-failure, excluded from latency the same way it is in the buckets);
// undefined on down readings and on pre-upgrade entries loaded from an old file.
export type Reading = { t: number; up: boolean; ms?: number };

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
  // `msWsum`/`msWtime` are the overlap-weighted latency numerator/denominator:
  // each up reading that carries an ms contributes ms × overlap, so a bar's
  // latency is the time-weighted average of the readings covering it. Readings
  // without an ms (down, or old entries) contribute to neither, so they don't
  // pull the average.
  const acc = Array.from({ length: bars }, () => ({
    up: 0,
    total: 0,
    msWsum: 0,
    msWtime: 0,
  }));
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
      if (r.up && r.ms != null) {
        acc[i].msWsum += r.ms * overlap;
        acc[i].msWtime += overlap;
      }
    }
  }
  return acc.map((a, i) => ({
    at: minuteStr(startMs + i * span),
    uptime: a.total === 0 ? null : (a.up / a.total) * 100,
    ms: a.msWtime === 0 ? null : Math.round(a.msWsum / a.msWtime),
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
  const acc = Array.from({ length: bars }, () => ({
    up: 0,
    down: 0,
    msCount: 0,
    msSum: 0,
  }));
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
      // Latency rides along with the same hour-overlap weight as up/down. The
      // weight cancels in the msSum/msCount ratio within a single hour and
      // correctly blends the ratios when a bar straddles several hours.
      acc[i].msCount += b.msCount * w;
      acc[i].msSum += b.msSum * w;
    }
  }
  return acc.map((a, i) => {
    const total = a.up + a.down;
    return {
      at: atOf(startMs + i * span),
      uptime: total === 0 ? null : (a.up / total) * 100,
      ms: a.msCount === 0 ? null : Math.round(a.msSum / a.msCount),
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

// Average/max latency across buckets at or after `sinceHour`, or null when no
// hour in the window carries a latency sample. The average uses `msCount` (the
// count of up checks that actually contributed an ms), NOT `up`, so a window
// that spans the upgrade boundary — pre-upgrade hours have up tallies but
// msCount 0 — averages only the hours that recorded latency instead of diluting
// the sum with checks that never sampled it.
export function latencyOverBuckets(
  buckets: Bucket[],
  sinceHour: number
): LatencyStat | null {
  let count = 0;
  let sum = 0;
  let max = 0;
  for (const b of buckets) {
    if (b.hour < sinceHour) continue;
    count += b.msCount;
    sum += b.msSum;
    if (b.msMax > max) max = b.msMax;
  }
  return count === 0 ? null : { avg: Math.round(sum / count), max: Math.round(max) };
}

// Average/max latency across the raw recent ring at/after `sinceMs`, or null if
// none. Mirrors recentPct but over up readings only — a down reading (or an old
// entry) has no ms and is skipped, so its time-to-failure never distorts the
// average.
export function recentLatency(
  readings: Reading[],
  sinceMs: number
): LatencyStat | null {
  let count = 0;
  let sum = 0;
  let max = 0;
  for (const r of readings) {
    if (r.t < sinceMs) continue;
    if (!r.up || r.ms == null) continue;
    count++;
    sum += r.ms;
    if (r.ms > max) max = r.ms;
  }
  return count === 0 ? null : { avg: Math.round(sum / count), max: Math.round(max) };
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

// Latency counterpart of dayWindows, over the same day-scale cutoffs. `h1` comes
// from the recent ring in getHistory.
function latencyDayWindows(
  buckets: Bucket[],
  nowHour: number
): Omit<LatencyWindows, "h1"> {
  return {
    d1: latencyOverBuckets(buckets, nowHour - 24),
    d7: latencyOverBuckets(buckets, nowHour - 24 * 7),
    d30: latencyOverBuckets(buckets, nowHour - 24 * 30),
    d90: latencyOverBuckets(buckets, nowHour - 24 * 90),
  };
}

// --- In-memory store + persistence (server-only) ---

type AppBuckets = Map<
  number,
  { up: number; down: number; msCount: number; msSum: number; msMax: number }
>;
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
// { apps:   { [id]: { [hour]: [up, down, msCount, msSum, msMax] } },
//   recent: { [id]: [[t, up?1:0, ms?], …] } }.
// The latency fields (msCount/msSum/msMax on a bucket, the third `ms` element on
// a recent entry) were added later, so the loader treats them as optional: a
// file written before this feature has 2-element bucket tuples and 2-element
// recent tuples, and those simply load with no latency data (zeros / undefined).
// Same migration posture as the rest of the config — old files must load without
// error.
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
        m.set(Number(hk), {
          up: v?.[0] ?? 0,
          down: v?.[1] ?? 0,
          msCount: v?.[2] ?? 0,
          msSum: v?.[3] ?? 0,
          msMax: v?.[4] ?? 0,
        });
      }
      next.set(id, m);
    }
    state.store = next;
    const recent = new Map<string, Reading[]>();
    const cutoff = Date.now() - RECENT_KEEP_MS;
    for (const [id, rows] of Object.entries(data?.recent ?? {})) {
      const list = (rows as number[][])
        .filter((r) => r?.[0] >= cutoff)
        .map((r) => {
          const reading: Reading = { t: r[0], up: r[1] === 1 };
          // Third element present only on up readings written by a new build;
          // absent on old files and on down readings — those keep ms undefined.
          if (r[2] != null) reading.ms = r[2];
          return reading;
        });
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
    const b = m.get(hour) ?? { up: 0, down: 0, msCount: 0, msSum: 0, msMax: 0 };
    if (r.up) {
      b.up++;
      // Latency is accumulated from up checks only. A down check's `ms` is its
      // time-to-failure — commonly the whole 5s request timeout — so folding it
      // into the average would drag every figure toward that ceiling and make a
      // flapping app look uniformly slow. msCount is bumped alongside msSum so
      // the average divides by the samples that actually contributed (never by
      // `up`, which on pre-upgrade hours counts checks with no ms recorded).
      b.msCount++;
      b.msSum += r.ms;
      if (r.ms > b.msMax) b.msMax = r.ms;
    } else {
      b.down++;
    }
    m.set(hour, b);
    for (const k of m.keys()) if (k < cutoff) m.delete(k);

    // Raw ring for the 1h view, pruned to the keep window. ms rides along on up
    // readings only, matching the bucket accumulators; a down reading keeps ms
    // undefined so the read path never averages its time-to-failure.
    const reading: Reading = { t: at, up: r.up };
    if (r.up) reading.ms = r.ms;
    const list = state.recent.get(r.id) ?? [];
    list.push(reading);
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
    const apps: Record<string, Record<number, number[]>> = {};
    for (const [id, m] of state.store) {
      const hours: Record<number, number[]> = {};
      for (const [hk, b] of m)
        hours[hk] = [b.up, b.down, b.msCount, b.msSum, b.msMax];
      apps[id] = hours;
    }
    const recent: Record<string, number[][]> = {};
    for (const [id, list] of state.recent) {
      // A 3-element tuple only when ms is present (up readings). Down/old
      // readings stay 2-element rather than writing an `undefined`/null third
      // slot, keeping the file compact; the loader keys off tuple length.
      if (list.length)
        recent[id] = list.map((r) =>
          r.ms == null ? [r.t, r.up ? 1 : 0] : [r.t, r.up ? 1 : 0, r.ms]
        );
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
      ? [...m].map(([hour, b]) => ({
          hour,
          up: b.up,
          down: b.down,
          msCount: b.msCount,
          msSum: b.msSum,
          msMax: b.msMax,
        }))
      : [];
    const readings = state.recent.get(id) ?? [];
    return {
      id,
      uptime: {
        h1: recentPct(readings, recentSince),
        ...dayWindows(buckets, nowHour),
      },
      // Latency windows parallel to `uptime`: h1 from the recent ring over the
      // same RECENT_VIEW_MS window, the day scales from the hourly buckets.
      latency: {
        h1: recentLatency(readings, recentSince),
        ...latencyDayWindows(buckets, nowHour),
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
