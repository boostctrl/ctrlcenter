import fs from "fs/promises";
import path from "path";
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

function dayStr(hour: number): string {
  return new Date(hour * HOUR_MS).toISOString().slice(0, 10);
}

// `YYYY-MM-DDThh` for an hourly bar's `at`.
function hourStr(hour: number): string {
  return new Date(hour * HOUR_MS).toISOString().slice(0, 13);
}

// `YYYY-MM-DDThh:mm` for a single recent poll's `at`.
function minuteStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16);
}

// One raw reading: timestamp (ms) + whether the app was up.
export type Reading = { t: number; up: boolean };

// The last hour of raw readings as one bar each (oldest → newest); each bar is
// binary — 100 when up, 0 when down — so a single poll reads as green/red.
export function recentBars(readings: Reading[], sinceMs: number): BarPoint[] {
  return readings
    .filter((r) => r.t >= sinceMs)
    .sort((a, b) => a.t - b.t)
    .map((r) => ({ at: minuteStr(r.t), uptime: r.up ? 100 : 0 }));
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

// A timeline of the last `days` UTC days (oldest → newest), each with that day's
// uptime % or null when nothing was recorded.
export function dailyTimeline(
  buckets: Bucket[],
  days: number,
  nowHour: number
): BarPoint[] {
  const byDay = new Map<string, { up: number; down: number }>();
  for (const b of buckets) {
    const date = dayStr(b.hour);
    const cur = byDay.get(date) ?? { up: 0, down: 0 };
    cur.up += b.up;
    cur.down += b.down;
    byDay.set(date, cur);
  }
  const nowMs = nowHour * HOUR_MS;
  const out: BarPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = dayStr(hourOf(nowMs - i * DAY_MS));
    const d = byDay.get(date);
    const total = d ? d.up + d.down : 0;
    out.push({ at: date, uptime: total === 0 ? null : (d!.up / total) * 100 });
  }
  return out;
}

// A timeline of the last `hours` hours (oldest → newest), one bar each, so recent
// activity is visible within the day (not only as days accrue).
export function hourlyTimeline(
  buckets: Bucket[],
  hours: number,
  nowHour: number
): BarPoint[] {
  const byHour = new Map<number, { up: number; down: number }>();
  for (const b of buckets) byHour.set(b.hour, { up: b.up, down: b.down });
  const out: BarPoint[] = [];
  for (let i = hours - 1; i >= 0; i--) {
    const hour = nowHour - i;
    const d = byHour.get(hour);
    const total = d ? d.up + d.down : 0;
    out.push({ at: hourStr(hour), uptime: total === 0 ? null : (d!.up / total) * 100 });
  }
  return out;
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

// Read history for the given app ids (preserving order) as the API payload — the
// last hour of per-poll bars + 24h of hourly bars + a 90-day daily timeline +
// uptime windows (h1 from the raw ring, the rest from the hourly buckets).
export function getHistory(ids: string[]): StatusHistory {
  const now = Date.now();
  const nowHour = hourOf(now);
  const recentSince = now - RECENT_VIEW_MS;
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
      recent: recentBars(readings, recentSince),
      hourly: hourlyTimeline(buckets, 24, nowHour),
      daily: dailyTimeline(buckets, 90, nowHour),
    };
  });
  return { generatedAt: Date.now(), apps };
}
