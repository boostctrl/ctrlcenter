import fs from "fs/promises";
import path from "path";
import type {
  StatusResult,
  StatusHistory,
  TimelinePoint,
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
): TimelinePoint[] {
  const byDay = new Map<string, { up: number; down: number }>();
  for (const b of buckets) {
    const date = dayStr(b.hour);
    const cur = byDay.get(date) ?? { up: 0, down: 0 };
    cur.up += b.up;
    cur.down += b.down;
    byDay.set(date, cur);
  }
  const nowMs = nowHour * HOUR_MS;
  const out: TimelinePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = dayStr(hourOf(nowMs - i * DAY_MS));
    const d = byDay.get(date);
    const total = d ? d.up + d.down : 0;
    out.push({ date, uptime: total === 0 ? null : (d!.up / total) * 100 });
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
let store = new Map<string, AppBuckets>();
let loaded = false;
let flushQueue: Promise<unknown> = Promise.resolve();

function historyPath(): string {
  const configPath =
    process.env.CONFIG_PATH || path.join(process.cwd(), "config", "config.yaml");
  return path.join(path.dirname(configPath), HISTORY_FILE);
}

// Load the persisted history into memory once (idempotent). Stored shape:
// { apps: { [appId]: { [hour]: [up, down] } } }.
export async function loadHistory(): Promise<void> {
  if (loaded) return;
  loaded = true;
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
    store = next;
  } catch {
    store = new Map();
  }
}

// Tally one round of results into the current hour, pruning anything older than
// the retention window.
export function recordResults(results: StatusResult[], at: number): void {
  const hour = hourOf(at);
  const cutoff = hour - RETENTION_HOURS;
  for (const r of results) {
    let m = store.get(r.id);
    if (!m) {
      m = new Map();
      store.set(r.id, m);
    }
    const b = m.get(hour) ?? { up: 0, down: 0 };
    if (r.up) b.up++;
    else b.down++;
    m.set(hour, b);
    for (const k of m.keys()) if (k < cutoff) m.delete(k);
  }
}

// Serialized write of the in-memory store to disk (mirrors config's writeQueue).
export function flush(): Promise<void> {
  flushQueue = flushQueue.then(async () => {
    const apps: Record<string, Record<number, [number, number]>> = {};
    for (const [id, m] of store) {
      const hours: Record<number, [number, number]> = {};
      for (const [hk, b] of m) hours[hk] = [b.up, b.down];
      apps[id] = hours;
    }
    try {
      await fs.mkdir(path.dirname(historyPath()), { recursive: true });
      await fs.writeFile(historyPath(), JSON.stringify({ apps }), "utf8");
    } catch {
      // best-effort; history is non-critical
    }
  });
  return flushQueue as Promise<void>;
}

// Read history for the given app ids (preserving order) as the API payload.
export function getHistory(ids: string[]): StatusHistory {
  const nowHour = hourOf(Date.now());
  const apps = ids.map((id) => {
    const m = store.get(id);
    const buckets: Bucket[] = m
      ? [...m].map(([hour, b]) => ({ hour, up: b.up, down: b.down }))
      : [];
    return { id, uptime: windows(buckets, nowHour), timeline: dailyTimeline(buckets, 90, nowHour) };
  });
  return { generatedAt: Date.now(), apps };
}
