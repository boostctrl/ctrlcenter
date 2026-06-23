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
const RETENTION_HOURS = 90 * 24;
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

function windows(buckets: Bucket[], nowHour: number): UptimeWindows {
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
  loaded: false,
  flushQueue: Promise.resolve(),
});

function historyPath(): string {
  const configPath =
    process.env.CONFIG_PATH || path.join(process.cwd(), "config", "config.yaml");
  return path.join(path.dirname(configPath), HISTORY_FILE);
}

// Load the persisted history into memory once (idempotent). Stored shape:
// { apps: { [appId]: { [hour]: [up, down] } } }.
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
  } catch {
    state.store = new Map();
  }
}

// Tally one round of results into the current hour, pruning anything older than
// the retention window.
export function recordResults(results: StatusResult[], at: number): void {
  const hour = hourOf(at);
  const cutoff = hour - RETENTION_HOURS;
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
    const file = historyPath();
    const tmp = `${file}.tmp`;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify({ apps }), "utf8");
      await fs.rename(tmp, file);
    } catch {
      // best-effort; history is non-critical
    }
  });
  return state.flushQueue as Promise<void>;
}

// Read history for the given app ids (preserving order) as the API payload —
// recent hourly bars (last 24h) + a 90-day daily timeline + uptime windows.
export function getHistory(ids: string[]): StatusHistory {
  const nowHour = hourOf(Date.now());
  const apps = ids.map((id) => {
    const m = state.store.get(id);
    const buckets: Bucket[] = m
      ? [...m].map(([hour, b]) => ({ hour, up: b.up, down: b.down }))
      : [];
    return {
      id,
      uptime: windows(buckets, nowHour),
      hourly: hourlyTimeline(buckets, 24, nowHour),
      daily: dailyTimeline(buckets, 90, nowHour),
    };
  });
  return { generatedAt: Date.now(), apps };
}
