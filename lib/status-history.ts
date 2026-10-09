import fs from "fs/promises";
import path from "path";
import { TIMELINE_BARS, DETAIL_BARS } from "./status";
import { log, errorReason } from "./log";
import type {
  StatusResult,
  StatusHistory,
  BarPoint,
  UptimeWindows,
  LatencyStat,
  LatencyWindows,
  AppHistory,
  AppDetail,
  OutageEntry,
} from "./status";
import { globalSingleton } from "./singleton";
import {
  openHistoryDb,
  readHistoryRows,
  readMeta,
  writeHistoryChanges,
  type DatabaseSync,
  type HistoryChanges,
  type HistoryRows,
  type ReadingRow,
} from "./status-history-db";

// Persisted uptime history for the /status page. The background poller
// (instrumentation.ts) records one up/down tally per app per hour; we keep 90
// days of hourly buckets in memory as the read model and persist each poll's
// changes to a SQLite database beside config.yaml (lib/status-history-db.ts,
// #278). Aggregation to uptime % / a daily timeline happens at read time.

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const RETENTION_HOURS = 90 * 24;
const RECENT_KEEP_MS = 90 * MIN_MS; // ring of raw readings kept for the 1h view
const RECENT_VIEW_MS = 60 * MIN_MS; // window the 1h view / h1 % actually show
// Completed-outage records kept per app (#175). Records follow the same 90-day
// retention as the buckets; the count cap only exists so a service flapping
// every poll can't grow the file without bound. Oldest records fall off first,
// and anything dropped degrades gracefully to the hour-bucket reconstruction.
const MAX_OUTAGES = 500;
const HISTORY_DB = "status-history.db";
// What builds before #278 wrote; imported once into the database.
const LEGACY_HISTORY_FILE = "status-history.json";

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

// One completed outage as the poller recorded it (#175): the exact down- and
// up-transition instants (ms). Written at the moment of recovery from the
// persisted `downSince` mark, so the pair stays poll-exact at any age instead
// of degrading to hour-bucket bounds when the recent ring ages it out. The
// start instant doubles as the outage's stable identity (with the app id) —
// which is what the admin's incident `note` (#176) anchors to.
export type RecordedOutage = { start: number; end: number; note?: string };

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

// Epoch ms of the app's oldest recorded sample across both stores, or null when
// it has none. The hourly buckets and the raw recent ring are independent, so
// the oldest is the min of a bucket's start instant (its hour × HOUR_MS) and a
// recent reading's `t`. The client compares this to a range's window start to
// tell whether the recorded history actually reaches back far enough to back
// the range's uptime %, and if not, how far back it really goes (the "since …"
// note on the /status page). It's all already in memory, so this is a plain
// min over what getHistory already builds.
export function oldestSampleMs(
  buckets: Bucket[],
  readings: Reading[]
): number | null {
  let oldestBucketHour: number | null = null;
  for (const b of buckets) {
    if (oldestBucketHour === null || b.hour < oldestBucketHour)
      oldestBucketHour = b.hour;
  }
  let oldestReading: number | null = null;
  for (const r of readings) {
    if (oldestReading === null || r.t < oldestReading) oldestReading = r.t;
  }
  if (oldestBucketHour === null) return oldestReading;
  // A bucket only knows its hour, so its start instant overstates coverage by
  // up to an hour — which on the 1h range can claim the whole window a
  // minutes-old app doesn't have. When the ring's oldest reading falls in that
  // same hour it's the sample that opened the bucket (or at worst a later one,
  // erring toward claiming less), so prefer the exact instant.
  if (oldestReading !== null && hourOf(oldestReading) <= oldestBucketHour)
    return oldestReading;
  return oldestBucketHour * HOUR_MS;
}

// Derive the detail page's outage log (#150) from the recorded history.
// Sources with different resolutions, stitched newest-wins:
//
// - The ONGOING outage comes from `downSinceMs` (the poller's persisted mark —
//   exact, and it can pre-date everything else). Recorded data at/after it is
//   the same outage and is not re-listed.
// - Completed outages come from `recorded` (#175): the exact transition pairs
//   the poller persisted at each recovery. Exact at any age.
// - Both fallbacks below exist only for history from before recording began —
//   pre-upgrade files — so they are clipped to strictly-before the first
//   recorded outage (they'd re-derive the same outages otherwise):
//   - Completed outages inside the recent ring's coverage are poll-exact: a
//     run of consecutive down readings, ended by the next up reading.
//   - Older outages come from the hourly buckets: a run of consecutive hours
//     each containing downtime. Bounds are hour-granular (`exact: false`) and
//     `downMs` is estimated from the down-check count × the poll interval. An
//     hour with no bucket at all breaks a run — the server wasn't watching,
//     and an unwatched gap must not be presented as one long outage.
//
// A final merge pass joins adjacent entries closer than the poll hold (a
// boundary artifact where one real outage straddles the ring/bucket seam), and
// the list is returned newest-first, capped at `maxEntries`.
export function extractOutages(
  recorded: RecordedOutage[],
  buckets: Bucket[],
  readings: Reading[],
  downSinceMs: number | null,
  now: number,
  intervalMinutes: number,
  maxEntries = 20
): OutageEntry[] {
  const holdMs = 2 * intervalMinutes * MIN_MS;
  const sorted = [...readings].sort((a, b) => a.t - b.t);
  const ringStart = sorted.length > 0 ? sorted[0].t : null;
  // Everything from the ongoing outage's start onward belongs to its single
  // entry; historical runs are clipped to strictly-before it.
  const historyEnd = downSinceMs ?? Infinity;
  const entries: OutageEntry[] = [];

  // Recorded outages (poll-exact at any age). Retention is enforced here as
  // well as at record/load time so a long-running server's in-memory records
  // age out on the same 90-day horizon as the buckets they sit beside.
  const retentionCutoff = now - RETENTION_HOURS * HOUR_MS;
  const recSorted = recorded
    .filter((o) => o.end >= retentionCutoff && o.start < historyEnd)
    .sort((a, b) => a.start - b.start);
  const firstRecordedMs = recSorted.length > 0 ? recSorted[0].start : Infinity;
  for (const o of recSorted) {
    const entry: OutageEntry = {
      startMs: o.start,
      endMs: o.end,
      downMs: o.end - o.start,
      exact: true,
      recorded: true,
    };
    if (o.note != null) entry.note = o.note;
    entries.push(entry);
  }

  // Ring runs (poll-exact), clipped to before recording began — a completed
  // run the poller observed after that is already a recorded entry, and
  // re-listing it would double the outage in the merge pass. A run that
  // reaches the ring's end without an observed recovery is the current
  // outage — represented by the downSince entry below when the mark exists,
  // or as ongoing from its first down reading when it doesn't (an old history
  // file without the mark).
  let runStart: number | null = null;
  for (const r of sorted) {
    if (!r.up && runStart === null) runStart = r.t;
    if (r.up && runStart !== null) {
      if (runStart < historyEnd && runStart < firstRecordedMs) {
        entries.push({
          startMs: runStart,
          endMs: r.t,
          downMs: r.t - runStart,
          exact: true,
        });
      }
      runStart = null;
    }
  }
  if (runStart !== null && downSinceMs === null) {
    entries.push({ startMs: runStart, endMs: null, downMs: now - runStart, exact: true });
  }

  // Bucket runs (hour-granular), only for hours neither the ring nor the
  // recorded entries already cover — and never past the ongoing outage's
  // start.
  const bucketCutoffHour = Math.min(
    ringStart !== null ? hourOf(ringStart) : Infinity,
    downSinceMs !== null ? hourOf(downSinceMs) : Infinity,
    firstRecordedMs !== Infinity ? hourOf(firstRecordedMs) : Infinity
  );
  const downHours = buckets
    .filter((b) => b.down > 0 && b.hour < bucketCutoffHour)
    .sort((a, b) => a.hour - b.hour);
  let run: { first: number; last: number; downChecks: number } | null = null;
  const flushRun = () => {
    if (!run) return;
    const startMs = run.first * HOUR_MS;
    const endMs = (run.last + 1) * HOUR_MS;
    entries.push({
      startMs,
      endMs,
      downMs: Math.min(run.downChecks * intervalMinutes * MIN_MS, endMs - startMs),
      exact: false,
    });
    run = null;
  };
  for (const b of downHours) {
    if (run && b.hour === run.last + 1) {
      run.last = b.hour;
      run.downChecks += b.down;
    } else {
      flushRun();
      run = { first: b.hour, last: b.hour, downChecks: b.down };
    }
  }
  flushRun();

  // The ongoing outage, from the persisted mark (exact even when it started
  // before the ring's oldest reading).
  if (downSinceMs !== null) {
    entries.push({
      startMs: downSinceMs,
      endMs: null,
      downMs: now - downSinceMs,
      exact: true,
    });
  }

  // Merge adjacent entries closer than the poll hold: one real outage can
  // straddle the bucket/ring seam and arrive here as two touching runs.
  // Recorded entries never take part — a recorded pair is one whole outage by
  // construction (the poller saw an up between two records, so two records
  // are two real outages), and each must stay its own row so its identity
  // (startMs) remains addressable for incident notes (#176).
  entries.sort((a, b) => a.startMs - b.startMs);
  const merged: OutageEntry[] = [];
  for (const e of entries) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      !prev.recorded &&
      !e.recorded &&
      prev.endMs !== null &&
      e.startMs - prev.endMs <= holdMs
    ) {
      prev.endMs = e.endMs;
      prev.downMs += e.downMs;
      prev.exact = prev.exact && e.exact;
    } else {
      merged.push({ ...e });
    }
  }
  return merged.reverse().slice(0, maxEntries);
}

// Day-scale windows from the hourly buckets. `h1` is added at read time from the
// raw recent ring (see getHistory), since the buckets are only hourly.
function dayWindows(
  buckets: Bucket[],
  nowHour: number
): Omit<UptimeWindows, "h1"> {
  return {
    d1: uptimePct(buckets, nowHour - 24),
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
  // Start instant (ms) of each app's *current* outage, held only for apps that
  // were down at the last poll. Set at the transition into down and cleared on
  // recovery (see recordResults), so it answers "how long has it been down?"
  // rather than "when was the last down poll?".
  downSince: Map<string, number>;
  // Completed outages per app (#175), oldest first: the exact {start, end}
  // pairs the poller persisted at each recovery. See RecordedOutage.
  outages: Map<string, RecordedOutage[]>;
  // When each app with history was first seen missing from the config. Pruning
  // waits PRUNE_GRACE_MS past this, so undoing a delete (#307) finds the
  // app's history still there.
  missingSince: Map<string, number>;
  loaded: boolean;
  // The in-flight (or finished) load, shared by every caller — see loadHistory.
  loading?: Promise<void>;
  flushQueue: Promise<unknown>;
  // What changed since the last flush — all flush() writes (#278).
  dirty: Dirty;
  // The open database, with the path it was opened for (CONFIG_PATH decides).
  db?: { file: string; handle: DatabaseSync };
};

type Dirty = {
  buckets: Set<string>; // bucketKey(id, hour)
  readings: ReadingRow[];
  downSince: Set<string>;
  outages: Set<string>;
  dropped: Set<string>;
};
const emptyDirty = (): Dirty => ({
  buckets: new Set(),
  readings: [],
  downSince: new Set(),
  outages: new Set(),
  dropped: new Set(),
});
const bucketKey = (id: string, hour: number) => `${hour}\u0000${id}`;

// Held on globalThis so the background poller (instrumentation.ts) and the API
// route share ONE instance even if Next bundles them into separate module
// graphs — otherwise the reader loads the file once and never sees the poller's
// ongoing writes ("one reading, then frozen").
const state = globalSingleton<HistoryState>("__ctrlcenterStatusHistory", () => ({
  store: new Map(),
  recent: new Map(),
  downSince: new Map(),
  outages: new Map(),
  missingSince: new Map(),
  loaded: false,
  flushQueue: Promise.resolve(),
  dirty: emptyDirty(),
}));
state.recent ??= new Map(); // tolerate a state created by an older build
state.downSince ??= new Map(); // ditto — added after the recent ring
state.outages ??= new Map(); // ditto — added with the recorded outages (#175)
state.missingSince ??= new Map(); // ditto — added with the prune grace (#307)
state.dirty ??= emptyDirty(); // ditto — added with the database (#278)

function historyDir(): string {
  // Untraced like CONFIG_PATH (lib/config.ts): a runtime path, not a build input.
  const configPath =
    process.env.CONFIG_PATH ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "config", "config.yaml");
  return path.dirname(configPath);
}

// The database for the current CONFIG_PATH, opened on first use. Throws when
// it can't be opened (unwritable directory, a newer schema, a damaged file).
function historyDb(): DatabaseSync {
  const file = path.join(historyDir(), HISTORY_DB);
  if (state.db?.file === file) return state.db.handle;
  state.db?.handle.close();
  state.db = undefined;
  const handle = openHistoryDb(file);
  state.db = { file, handle };
  return handle;
}

// SQLite's "not a database" and "malformed" result codes.
const isDamaged = (e: unknown) =>
  typeof e === "object" && e !== null && [11, 26].includes((e as { errcode?: number }).errcode ?? 0);

// Load the persisted history into memory once (idempotent).
export function loadHistory(): Promise<void> {
  // Every caller awaits the same load: a request (or the poller's first tick)
  // arriving while the history is still being read must wait for it, not see
  // an empty store.
  state.loading ??= readHistory();
  return state.loading;
}

async function readHistory(): Promise<void> {
  if (state.loaded) return;
  state.loaded = true;
  // Memory is about to mirror the database; pending changes are moot.
  state.dirty = emptyDirty();
  applyRows({ buckets: [], readings: [], downSince: [], outages: [] });
  await fs.mkdir(historyDir(), { recursive: true }).catch(() => undefined);
  let db: DatabaseSync;
  try {
    db = historyDb();
    await importLegacyOnce(db);
  } catch (e) {
    if (!isDamaged(e)) {
      // Unwritable, or from a newer version: run on in memory, and say why
      // (each flush will too) rather than touch a file we don't understand.
      log.warn("status history unavailable", { reason: errorReason(e) });
      return;
    }
    // A damaged file can't be read by anyone: set it aside, start afresh.
    const file = path.join(historyDir(), HISTORY_DB);
    state.db?.handle.close();
    state.db = undefined;
    const aside = `${file}.damaged-${Date.now()}`;
    await fs.rename(file, aside).catch(() => undefined);
    log.warn("status history was damaged; starting a new one", { savedAs: aside });
    try {
      db = historyDb();
      await importLegacyOnce(db);
    } catch (e2) {
      log.warn("status history unavailable", { reason: errorReason(e2) });
      return;
    }
  }
  const now = Date.now();
  applyRows(
    readHistoryRows(db, {
      minReadingT: now - RECENT_KEEP_MS,
      minOutageEnd: now - RETENTION_HOURS * HOUR_MS,
    })
  );
}

// Replace the in-memory history with `rows`.
function applyRows(rows: HistoryRows): void {
  const store = new Map<string, AppBuckets>();
  for (const b of rows.buckets) {
    let m = store.get(b.app);
    if (!m) store.set(b.app, (m = new Map()));
    m.set(b.hour, {
      up: b.up,
      down: b.down,
      msCount: b.msCount,
      msSum: b.msSum,
      msMax: b.msMax,
    });
  }
  const recent = new Map<string, Reading[]>();
  for (const r of rows.readings) {
    const reading: Reading = { t: r.t, up: r.up };
    if (r.ms != null) reading.ms = r.ms;
    const list = recent.get(r.app);
    if (list) list.push(reading);
    else recent.set(r.app, [reading]);
  }
  const outages = new Map<string, RecordedOutage[]>();
  for (const o of rows.outages) {
    const rec: RecordedOutage = { start: o.start, end: o.end };
    if (o.note) rec.note = o.note;
    const list = outages.get(o.app);
    if (list) list.push(rec);
    else outages.set(o.app, [rec]);
  }
  state.store = store;
  state.recent = recent;
  state.downSince = new Map(rows.downSince.map((d) => [d.app, d.since]));
  state.outages = outages;
}

// The first time a database is opened, carry over the JSON history an older
// build wrote (if any), in the same transaction that marks the import done.
// The JSON file is left in place, so going back to an older version still
// finds its history (as of the upgrade).
async function importLegacyOnce(db: DatabaseSync): Promise<void> {
  if (readMeta(db, "legacyImport") !== undefined) return;
  let rows: HistoryRows = { buckets: [], readings: [], downSince: [], outages: [] };
  let found = false;
  try {
    const raw = await fs.readFile(path.join(historyDir(), LEGACY_HISTORY_FILE), "utf8");
    rows = parseLegacyHistory(JSON.parse(raw), Date.now());
    found = true;
  } catch {
    // No file, or one that doesn't parse — nothing to carry over.
  }
  const now = Date.now();
  writeHistoryChanges(db, {
    dropApps: [],
    buckets: rows.buckets,
    readings: rows.readings,
    downSince: rows.downSince,
    outages: groupOutages(rows.outages),
    ...retentionCutoffs(now),
    meta: { legacyImport: found ? `imported ${new Date(now).toISOString()}` : "none" },
  });
}

function groupOutages(rows: HistoryRows["outages"]): HistoryChanges["outages"] {
  const byApp = new Map<string, HistoryRows["outages"]>();
  for (const o of rows) byApp.set(o.app, [...(byApp.get(o.app) ?? []), o]);
  return [...byApp].map(([app, list]) => ({ app, list }));
}

function retentionCutoffs(now: number) {
  return {
    minHour: hourOf(now) - RETENTION_HOURS,
    minReadingT: now - RECENT_KEEP_MS,
    minOutageEnd: now - RETENTION_HOURS * HOUR_MS,
  };
}

// Parse the JSON history file older builds wrote. Stored shape:
// { apps:   { [id]: { [hour]: [up, down, msCount, msSum, msMax] } },
//   recent: { [id]: [[t, up?1:0, ms?], …] },
//   downSince: { [id]: ms },
//   outages: { [id]: [[start, end, note?], …] } }.
// The latency fields (msCount/msSum/msMax on a bucket, the third `ms` element on
// a recent entry), the `downSince` map, and the `outages` records (#175) were
// all added later, so they're optional: a file written before those features
// has 2-element bucket tuples, 2-element recent tuples, and no
// `downSince`/`outages` keys, and simply loads with no latency data (zeros /
// undefined), no outage marks, and no outage records. Readings and outages
// past their retention are dropped on the way in.
export function parseLegacyHistory(data: unknown, now: number): HistoryRows {
  const d = (data ?? {}) as {
    apps?: Record<string, Record<string, number[]>>;
    recent?: Record<string, number[][]>;
    downSince?: Record<string, unknown>;
    outages?: Record<string, unknown[][]>;
  };
  const rows: HistoryRows = { buckets: [], readings: [], downSince: [], outages: [] };
  for (const [app, hours] of Object.entries(d.apps ?? {})) {
    for (const [hk, v] of Object.entries(hours ?? {})) {
      rows.buckets.push({
        app,
        hour: Number(hk),
        up: v?.[0] ?? 0,
        down: v?.[1] ?? 0,
        msCount: v?.[2] ?? 0,
        msSum: v?.[3] ?? 0,
        msMax: v?.[4] ?? 0,
      });
    }
  }
  const cutoff = now - RECENT_KEEP_MS;
  for (const [app, list] of Object.entries(d.recent ?? {})) {
    for (const r of list ?? []) {
      if (!(r?.[0] >= cutoff)) continue;
      // Third element present only on up readings written by a newer build;
      // absent on old files and on down readings — those keep ms undefined.
      const reading: ReadingRow = { app, t: r[0], up: r[1] === 1 };
      if (r[2] != null) reading.ms = r[2];
      rows.readings.push(reading);
    }
  }
  // Current-outage marks. Absent on older files → no app is considered
  // mid-outage until the next down poll re-establishes it.
  for (const [app, since] of Object.entries(d.downSince ?? {}))
    if (typeof since === "number") rows.downSince.push({ app, since });
  // Recorded outages (#175). Absent on older files → those files' completed
  // outages surface via the ring/bucket fallbacks instead.
  const outageCutoff = now - RETENTION_HOURS * HOUR_MS;
  for (const [app, list] of Object.entries(d.outages ?? {})) {
    for (const o of list ?? []) {
      if (typeof o?.[0] !== "number" || typeof o?.[1] !== "number") continue;
      if (o[1] < outageCutoff) continue;
      const row: HistoryRows["outages"][number] = { app, start: o[0], end: o[1] };
      // Third element is the incident note (#176), present only when set.
      if (typeof o[2] === "string" && o[2] !== "") row.note = o[2];
      rows.outages.push(row);
    }
  }
  return rows;
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
    state.dirty.buckets.add(bucketKey(r.id, hour));
    for (const k of m.keys()) if (k < cutoff) m.delete(k);

    // Raw ring for the 1h view, pruned to the keep window. ms rides along on up
    // readings only, matching the bucket accumulators; a down reading keeps ms
    // undefined so the read path never averages its time-to-failure.
    const reading: Reading = { t: at, up: r.up };
    if (r.up) reading.ms = r.ms;
    const list = state.recent.get(r.id) ?? [];
    list.push(reading);
    state.dirty.readings.push({ app: r.id, ...reading });
    state.recent.set(
      r.id,
      list.filter((x) => x.t >= recentCutoff)
    );

    // Track the *current* outage's start. Stamp it only on the transition into
    // the down state — the `has` guard keeps consecutive down polls from
    // advancing the mark to the latest failure, so it stays the outage's start
    // — and clear it the moment the app answers, so the map holds exactly the
    // apps down right now. This is what lets the page say how long an app has
    // been down (see getHistory / AppHistory.downSince).
    //
    // The up transition is also where a completed outage becomes history
    // (#175): the mark and the recovery instant are persisted as an exact
    // {start, end} record, so the outage log never has to re-guess the bounds
    // from hourly tallies after the ring ages the readings out. If the server
    // was off when the app recovered, `at` is the first poll that saw it up
    // again — the closest observed bound, same as the mark's own semantics.
    if (r.up) {
      const since = state.downSince.get(r.id);
      if (since !== undefined) {
        const list = state.outages.get(r.id) ?? [];
        list.push({ start: since, end: at });
        state.outages.set(
          r.id,
          list
            .filter((o) => o.end >= at - RETENTION_HOURS * HOUR_MS)
            .slice(-MAX_OUTAGES)
        );
        state.downSince.delete(r.id);
        state.dirty.downSince.add(r.id);
        state.dirty.outages.add(r.id);
      }
    } else if (!state.downSince.has(r.id)) {
      state.downSince.set(r.id, at);
      state.dirty.downSince.add(r.id);
    }
  }
}

// How long an app must be gone from the config before its history is dropped:
// comfortably past the admin's Undo window (#307), short enough that a deleted
// app doesn't linger in the file.
export const PRUNE_GRACE_MS = 10 * 60 * 1000;

// Forget every app not in `keepIds` once it has been missing for
// PRUNE_GRACE_MS — its hourly buckets, recent readings, open-outage mark, and
// recorded outages. Called by the poller with the configured app list, so a
// deleted app's history isn't carried indefinitely. Returns how many apps were dropped.
export function pruneHistory(keepIds: readonly string[], now = Date.now()): number {
  const keep = new Set(keepIds);
  for (const id of state.missingSince.keys()) {
    if (keep.has(id)) state.missingSince.delete(id); // restored in time
  }
  const maps = [state.store, state.recent, state.downSince, state.outages];
  const gone = new Set<string>();
  for (const map of maps) {
    for (const id of map.keys()) {
      if (keep.has(id)) continue;
      const since = state.missingSince.get(id);
      if (since === undefined) state.missingSince.set(id, now);
      else if (now - since >= PRUNE_GRACE_MS) gone.add(id);
    }
  }
  for (const id of gone) {
    for (const map of maps) map.delete(id);
    state.missingSince.delete(id);
    forgetDirty(state.dirty, id);
    state.dirty.dropped.add(id);
  }
  return gone.size;
}

// Drop an app's pending changes (it's being deleted).
function forgetDirty(d: Dirty, id: string): void {
  for (const k of d.buckets) if (k.endsWith(`\u0000${id}`)) d.buckets.delete(k);
  d.readings = d.readings.filter((r) => r.app !== id);
  d.downSince.delete(id);
  d.outages.delete(id);
}

// Write what changed since the last flush, serialized and in one transaction
// (#278). On failure the changes are kept for the next flush to retry.
export function flush(): Promise<void> {
  state.flushQueue = state.flushQueue.then(() => {
    const dirty = state.dirty;
    state.dirty = emptyDirty();
    try {
      writeHistoryChanges(historyDb(), changesFrom(dirty, Date.now()));
    } catch (e) {
      mergeDirty(dirty);
      // Best-effort — history is non-critical and the next flush retries —
      // but leave a trace, or a full disk or read-only volume would silently
      // stop the uptime history from persisting.
      log.warn("status history write failed", { reason: errorReason(e) });
    }
  });
  return state.flushQueue as Promise<void>;
}

// The database writes for a set of changes, read from the in-memory model.
function changesFrom(d: Dirty, now: number): HistoryChanges {
  const buckets: HistoryChanges["buckets"] = [];
  for (const key of d.buckets) {
    const sep = key.indexOf("\u0000");
    const hour = Number(key.slice(0, sep));
    const app = key.slice(sep + 1);
    // Gone from memory means retention dropped it; so will the DELETE.
    const b = state.store.get(app)?.get(hour);
    if (b) buckets.push({ app, hour, ...b });
  }
  return {
    dropApps: [...d.dropped],
    buckets,
    readings: d.readings,
    downSince: [...d.downSince].map((app) => ({
      app,
      since: state.downSince.get(app) ?? null,
    })),
    outages: [...d.outages].map((app) => ({
      app,
      list: (state.outages.get(app) ?? []).map((o) => ({ app, ...o })),
    })),
    ...retentionCutoffs(now),
  };
}

// Put a failed flush's changes back in front of anything recorded since.
function mergeDirty(failed: Dirty): void {
  const now = state.dirty;
  for (const id of now.dropped) forgetDirty(failed, id);
  state.dirty = {
    buckets: new Set([...failed.buckets, ...now.buckets]),
    readings: [...failed.readings, ...now.readings],
    downSince: new Set([...failed.downSince, ...now.downSince]),
    outages: new Set([...failed.outages, ...now.outages]),
    dropped: new Set([...failed.dropped, ...now.dropped]),
  };
}

// Set, replace, or clear (empty string) the incident note on one recorded
// outage (#176), anchored by the app id + the record's exact start instant.
// Notes live with the outage records in the history database — server-recorded
// state, not config — so they don't travel with config export/import, same as
// the outage history they annotate. Returns false when no record of `id`
// starts at `startMs` (unknown app, a legacy pre-#175 entry, or a record that
// aged out): there is nothing stable to anchor the note to. The caller flushes.
export function setOutageNote(
  id: string,
  startMs: number,
  note: string
): boolean {
  const rec = state.outages.get(id)?.find((o) => o.start === startMs);
  if (!rec) return false;
  if (note === "") delete rec.note;
  else rec.note = note;
  state.dirty.outages.add(id);
  return true;
}

// One app's stored data as plain arrays (empty when the id has none).
function appData(id: string): { buckets: Bucket[]; readings: Reading[] } {
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
  return { buckets, readings: state.recent.get(id) ?? [] };
}

// One app's history payload: uptime/latency windows (h1 from the raw ring, the
// rest from the hourly buckets) plus one `bars`-long strip per range. The day
// labels use `timeZone`'s calendar date. `intervalMinutes` is the poller
// cadence: a 1h reading holds for up to twice that, so normal polling paints a
// continuous strip while a stalled poller still shows a gap.
function appHistory(
  id: string,
  now: number,
  timeZone: string,
  intervalMinutes: number,
  bars: number
): AppHistory {
  const nowHour = hourOf(now);
  const recentSince = now - RECENT_VIEW_MS;
  const holdMs = 2 * intervalMinutes * MIN_MS;
  const dayAt = (ms: number) => localDayStr(ms, timeZone);
  const { buckets, readings } = appData(id);
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
      h1: fixedBarsFromReadings(readings, recentSince, now, bars, holdMs),
      d1: fixedBarsFromBuckets(buckets, now - DAY_MS, now, bars, minuteStr),
      d30: fixedBarsFromBuckets(buckets, now - 30 * DAY_MS, now, bars, dayAt),
      d90: fixedBarsFromBuckets(buckets, now - 90 * DAY_MS, now, bars, dayAt),
    },
    // How far back this app's data actually reaches, so the client can flag an
    // uptime % that covers less range than its toggle claims (see AppHistory).
    since: oldestSampleMs(buckets, readings),
    // Start of this app's current outage as the poller sees it, or null when
    // it was up at the last poll — the page turns this into "Down for 23m".
    downSince: state.downSince.get(id) ?? null,
  };
}

// Read history for the given app ids (preserving order) as the API payload.
// Every strip is TIMELINE_BARS long — the 1h view resamples the raw ring, the
// day-scale views resample the hourly buckets — so all four ranges draw an
// identically-sized heartbeat.
export function getHistory(
  ids: string[],
  timeZone = "UTC",
  intervalMinutes = 5
): StatusHistory {
  const now = Date.now();
  return {
    generatedAt: now,
    apps: ids.map((id) =>
      appHistory(id, now, timeZone, intervalMinutes, TIMELINE_BARS)
    ),
  };
}

// One app's detail payload (#150): the same history shape at the detail
// page's higher resolution, plus the derived outage log. Visibility is the
// caller's job — the API route 404s ids the caller may not see.
export function getAppDetail(
  id: string,
  timeZone = "UTC",
  intervalMinutes = 5
): AppDetail {
  const now = Date.now();
  const { buckets, readings } = appData(id);
  return {
    ...appHistory(id, now, timeZone, intervalMinutes, DETAIL_BARS),
    outages: extractOutages(
      state.outages.get(id) ?? [],
      buckets,
      readings,
      state.downSince.get(id) ?? null,
      now,
      intervalMinutes
    ),
  };
}
