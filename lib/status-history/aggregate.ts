// Pure aggregation helpers for the uptime history (#290 split): hourly
// buckets and raw readings in, uptime %, latency, fixed-width bar strips and
// the outage log out. No state, no I/O — unit-tested directly.
import type {
  BarPoint,
  UptimeWindows,
  LatencyStat,
  LatencyWindows,
  OutageEntry,
} from "../status";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
export const MIN_MS = 60_000;
export const RETENTION_HOURS = 90 * 24;
export const RECENT_KEEP_MS = 90 * MIN_MS; // ring of raw readings kept for the 1h view
export const RECENT_VIEW_MS = 60 * MIN_MS; // window the 1h view / h1 % actually show

// One hour's tally for one app. `up`/`down` count checks; the three `ms*` fields
// are the latency accumulators (average = msSum / msCount, plus a running max).
// `msCount` is tracked separately rather than reused from `up` on purpose:
// buckets recorded before this feature shipped carry an `up` tally but zero
// latency samples, so dividing `msSum` by `up` would divide by checks that never
// contributed and understate the average across the upgrade boundary. Only up
// checks feed the latency accumulators (see recordResults), so on fully-recorded
// hours msCount == up anyway.
//
// `maint` counts down checks inside a maintenance window (#293): kept apart
// from `down` so they never lower uptime, and so the bar can show them.
export type Bucket = {
  hour: number;
  up: number;
  down: number;
  maint?: number;
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
export function localDayStr(ms: number, timeZone: string): string {
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
export function minuteStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16);
}

// One raw reading: timestamp (ms) + whether the app was up. `ms` is the
// round-trip latency, stamped on up readings only (a down reading's ms is
// time-to-failure, excluded from latency the same way it is in the buckets);
// undefined on down readings and on pre-upgrade entries loaded from an old file.
// `maint` marks a down reading inside a maintenance window (#293), which
// counts neither for nor against uptime.
export type Reading = { t: number; up: boolean; ms?: number; maint?: boolean };

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
    maint: 0,
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
      if (r.maint) {
        acc[i].maint += overlap;
        continue;
      }
      acc[i].total += overlap;
      if (r.up) acc[i].up += overlap;
      if (r.up && r.ms != null) {
        acc[i].msWsum += r.ms * overlap;
        acc[i].msWtime += overlap;
      }
    }
  }
  return acc.map((a, i) =>
    withMaint(
      {
        at: minuteStr(startMs + i * span),
        uptime: a.total === 0 ? null : (a.up / a.total) * 100,
        ms: a.msWtime === 0 ? null : Math.round(a.msWsum / a.msWtime),
      },
      a.maint > 0 && a.up === a.total
    )
  );
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
    maint: 0,
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
      acc[i].maint += (b.maint ?? 0) * w;
      // Latency rides along with the same hour-overlap weight as up/down. The
      // weight cancels in the msSum/msCount ratio within a single hour and
      // correctly blends the ratios when a bar straddles several hours.
      acc[i].msCount += b.msCount * w;
      acc[i].msSum += b.msSum * w;
    }
  }
  return acc.map((a, i) => {
    const total = a.up + a.down;
    return withMaint(
      {
        at: atOf(startMs + i * span),
        uptime: total === 0 ? null : (a.up / total) * 100,
        ms: a.msCount === 0 ? null : Math.round(a.msSum / a.msCount),
      },
      a.maint > 0 && a.down === 0
    );
  });
}

// A bar with maintenance downtime and no real downtime is a maintenance bar
// (#293); real downtime in the same bar wins, since that's the news.
function withMaint(p: BarPoint, maint: boolean): BarPoint {
  return maint ? { ...p, maint: true } : p;
}

// Uptime % (0–100) across readings at/after `sinceMs`, or null if none.
export function recentPct(readings: Reading[], sinceMs: number): number | null {
  let up = 0;
  let total = 0;
  for (const r of readings) {
    if (r.t < sinceMs || r.maint) continue;
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
    if (r.maint) continue; // maintenance is not an outage (#293)
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
export function dayWindows(
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
export function latencyDayWindows(
  buckets: Bucket[],
  nowHour: number
): Omit<LatencyWindows, "h1"> {
  return {
    d1: latencyOverBuckets(buckets, nowHour - 24),
    d30: latencyOverBuckets(buckets, nowHour - 24 * 30),
    d90: latencyOverBuckets(buckets, nowHour - 24 * 90),
  };
}
