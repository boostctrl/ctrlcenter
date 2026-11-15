// The Monitor's recorded history (#530): each integration's headline numbers
// once a minute while the server runs, so a page can chart the last hour and
// the last day rather than only the number right now. A reading comes from
// every successful snapshot (the background sampler's, lib/monitor-sampler.ts,
// or a page's); the readings of one minute share a slot, the latest winning.
//
// Kept in memory, a day per integration, and spooled to
// `monitor-history.json` beside config.yaml every few minutes (temp + rename,
// mode 0600), read back at startup, so a restart keeps the day. Only numbers
// are recorded, never a name or an address the services report.
import fs from "node:fs/promises";
import path from "node:path";
import type { ServiceId } from "./services/ids";
import { globalSingleton } from "./singleton";
import { log, errorReason } from "./log";

const MINUTE = 60_000;
export const HISTORY_WINDOW_MS = 24 * 60 * MINUTE;
const FILE_NAME = "monitor-history.json";
// How often the spool is rewritten while readings come in.
const SPOOL_EVERY_MS = 5 * MINUTE;
// The metrics a reading may hold, and the integrations kept: a config of
// hundreds can't grow the spool without bound.
const MAX_METRICS = 8;
const MAX_INTEGRATIONS = 64;

export type Reading = { at: number; values: Record<string, number> };
type Series = { type: ServiceId; readings: Reading[] };

type State = {
  series: Map<string, Series>;
  loaded: Promise<void> | null;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
};
const state = globalSingleton<State>("__ctrlcenterMonitorHistory", () => ({
  series: new Map(),
  loaded: null,
  dirty: false,
  timer: undefined,
}));

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// The numbers worth charting for each type, from its tile snapshot. A type
// whose service keeps its own history (AdGuard's stats window) or whose
// numbers barely move within a day (Sonarr, Radarr) records nothing.
export function metricsOf(type: ServiceId, data: unknown): Record<string, number> | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const pick = (values: Record<string, unknown>) => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) if (finite(v)) out[k] = v;
    return Object.keys(out).length ? out : null;
  };
  switch (type) {
    case "qbittorrent":
      return pick({ down: d.downSpeed, up: d.upSpeed });
    case "tautulli":
      return pick({ streams: d.streamCount, transcodes: d.transcodeCount, bandwidth: d.totalBandwidthKbps });
    case "unifi": {
      const clients = d.clients as Record<string, unknown> | undefined;
      const internet = d.internet as Record<string, unknown> | undefined;
      return pick({
        clients: clients?.total,
        wifi: clients?.wireless,
        wired: clients?.wired,
        latency: internet?.latencyMs,
        down: internet?.downRate,
        up: internet?.upRate,
      });
    }
    case "portainer": {
      const t = d.totals as Record<string, unknown> | undefined;
      return pick({ running: t?.running, stopped: t?.stopped, unhealthy: t?.unhealthy });
    }
    case "truenas": {
      const pools = Array.isArray(d.pools) ? (d.pools as Record<string, unknown>[]) : [];
      const ratios = pools.map((p) => p.usedRatio).filter(finite);
      const apps = Array.isArray(d.apps) ? (d.apps as Record<string, unknown>[]) : [];
      return pick({
        used: ratios.length ? Math.max(...ratios) : undefined,
        apps: apps.filter((a) => a.running === true).length,
      });
    }
    case "seerr":
      return pick({ pending: d.pending, processing: d.processing });
    default:
      return null;
  }
}

// Record a snapshot's numbers for an integration. The readings of one minute
// share a slot; anything older than the window drops off.
export function recordSnapshot(id: string, type: ServiceId, data: unknown, at = Date.now()): void {
  const values = metricsOf(type, data);
  if (!values) return;
  const kept = Object.fromEntries(Object.entries(values).slice(0, MAX_METRICS));
  let series = state.series.get(id);
  if (!series || series.type !== type) {
    if (!series && state.series.size >= MAX_INTEGRATIONS) return;
    series = { type, readings: [] };
    state.series.set(id, series);
  }
  const slot = Math.floor(at / MINUTE) * MINUTE;
  const last = series.readings[series.readings.length - 1];
  if (last && last.at === slot) last.values = kept;
  else if (!last || slot > last.at) series.readings.push({ at: slot, values: kept });
  else return;
  const cutoff = at - HISTORY_WINDOW_MS;
  while (series.readings.length && series.readings[0].at < cutoff) series.readings.shift();
  scheduleSpool();
}

// Forget an integration's history: it was removed, or its type changed.
export function forgetHistory(keep: (id: string) => boolean): void {
  for (const id of [...state.series.keys()]) if (!keep(id)) state.series.delete(id);
}

export type HistoryRange = "hour" | "day";
export type History = {
  range: HistoryRange;
  // Each point's start (epoch ms), oldest first, and each metric's value
  // there (null where nothing was recorded).
  at: number[];
  series: Record<string, (number | null)[]>;
};

// An integration's readings over a range, as evenly spaced points: the last
// hour minute by minute, the last day in 15-minute averages. Gaps (the
// server was down, the service didn't answer) stay null, so a chart breaks
// rather than drawing a line across them.
export function historyOf(id: string, range: HistoryRange, now = Date.now()): History {
  const step = range === "hour" ? MINUTE : 15 * MINUTE;
  const count = range === "hour" ? 60 : 96;
  const end = Math.floor(now / step) * step;
  const start = end - (count - 1) * step;
  const at = Array.from({ length: count }, (_, i) => start + i * step);
  const readings = (state.series.get(id)?.readings ?? []).filter((r) => r.at >= start);
  const keys = [...new Set(readings.flatMap((r) => Object.keys(r.values)))];
  const series: History["series"] = {};
  for (const key of keys) {
    const buckets: number[][] = at.map(() => []);
    for (const r of readings) {
      const v = r.values[key];
      if (!finite(v)) continue;
      const i = Math.floor((r.at - start) / step);
      if (i >= 0 && i < count) buckets[i].push(v);
    }
    series[key] = buckets.map((b) => (b.length ? sum(b) / b.length : null));
  }
  return { range, at, series };
}

// --- The spool ---

function spoolPath(): string {
  const configPath =
    process.env.CONFIG_PATH ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "config", "config.yaml");
  return path.join(path.dirname(configPath), FILE_NAME);
}

function scheduleSpool(): void {
  state.dirty = true;
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = undefined;
    void writeSpool();
  }, SPOOL_EVERY_MS);
  // Never hold the process open for it.
  state.timer.unref?.();
}

let warned = false;
export async function writeSpool(): Promise<void> {
  if (!state.dirty) return;
  state.dirty = false;
  const file = spoolPath();
  const tmp = `${file}.${process.pid}.tmp`;
  const body = {
    version: 1,
    series: Object.fromEntries([...state.series].map(([id, s]) => [id, s])),
  };
  try {
    await fs.writeFile(tmp, JSON.stringify(body), { mode: 0o600 });
    await fs.rename(tmp, file);
  } catch (e) {
    if (!warned) log.warn(`can't save the Monitor's history: ${errorReason(e)}`);
    warned = true;
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

// Read the spool back, once. A missing, unreadable or foreign one starts the
// history empty; readings past the window are dropped.
export function loadHistory(now = Date.now()): Promise<void> {
  state.loaded ??= (async () => {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(spoolPath(), "utf8"));
    } catch {
      return;
    }
    const series = (raw as { version?: unknown; series?: unknown })?.series;
    if ((raw as { version?: unknown })?.version !== 1 || !series || typeof series !== "object") return;
    for (const [id, s] of Object.entries(series as Record<string, unknown>).slice(0, MAX_INTEGRATIONS)) {
      const { type, readings } = (s ?? {}) as { type?: unknown; readings?: unknown };
      if (typeof type !== "string" || !Array.isArray(readings)) continue;
      const kept = readings
        .filter(
          (r): r is Reading =>
            !!r &&
            finite((r as Reading).at) &&
            (r as Reading).at >= now - HISTORY_WINDOW_MS &&
            !!(r as Reading).values &&
            typeof (r as Reading).values === "object" &&
            Object.values((r as Reading).values).every(finite)
        )
        .sort((a, b) => a.at - b.at);
      // Readings recorded since startup are newer; keep them.
      const live = state.series.get(id);
      state.series.set(id, {
        type: type as ServiceId,
        readings: [...kept.filter((r) => !live || r.at < (live.readings[0]?.at ?? Infinity)), ...(live?.readings ?? [])],
      });
    }
  })();
  return state.loaded;
}

// For the tests: start over.
export function resetHistory(): void {
  state.series.clear();
  state.loaded = null;
  state.dirty = false;
  if (state.timer) clearTimeout(state.timer);
  state.timer = undefined;
}
