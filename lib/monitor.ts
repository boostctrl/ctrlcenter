// The shared poll/cache behind the private Monitor dashboard (#189, #207):
// one snapshot per integration, cached stale-while-revalidate so however many
// admin tabs are polling, each service sees at most one in-flight request and
// one fetch per TTL window. Mirrors the RSS feed cache (lib/feed.ts): a fresh
// entry is served as-is, an expired one is served immediately with the
// refresh running behind the response, only a cold cache blocks, and a failed
// refresh keeps the last good data (stale-on-failure) with the error beside
// it. Held on globalThis because lib module state forks per route bundle.
//
// Everything here is admin-only data — the /api/monitor route and the
// /admin/monitor page are the only consumers, both behind the session gate.

import type { IntegrationsConfig } from "./schema";
import {
  getQbittorrentSnapshot,
  type QbittorrentSnapshot,
} from "./services/qbittorrent";
import { getArrSnapshot, type ArrSnapshot } from "./services/arr";
import { ServiceError } from "./services/http";
import { log, errorReason } from "./log";

export const MONITOR_SERVICE_IDS = ["qbittorrent", "sonarr", "radarr"] as const;
export type MonitorServiceId = (typeof MONITOR_SERVICE_IDS)[number];

// One service's slice of the dashboard: the last good snapshot when there is
// one, the latest failure when there isn't — or both, when a refresh fails
// behind stale data. `configured` = enabled with a URL set; an unconfigured
// service renders as a set-up hint, not an error.
export type ServiceStatus<T> = {
  configured: boolean;
  data: T | null;
  error: string | null;
  // When `data`/`error` was recorded (epoch ms); null when never fetched.
  at: number | null;
};

export type MonitorSnapshot = {
  qbittorrent: ServiceStatus<QbittorrentSnapshot>;
  sonarr: ServiceStatus<ArrSnapshot>;
  radarr: ServiceStatus<ArrSnapshot>;
};

// Snappier than the feed cache's 5 minutes — this page is "what's happening
// right now" — while still collapsing a burst of open tabs into one fetch.
const MONITOR_TTL_MS = 30_000;

type CacheEntry = {
  // Fingerprint of the config that produced the entry: an edit invalidates
  // immediately instead of serving the old target's data for another TTL.
  key: string;
  data: unknown;
  error: string | null;
  at: number;
};

const g = globalThis as unknown as {
  __ctrlcenterMonitorCache?: Map<MonitorServiceId, CacheEntry>;
  __ctrlcenterMonitorRefresh?: Map<string, Promise<void>>;
};
const cache = (g.__ctrlcenterMonitorCache ??= new Map());
// Keyed by service + fingerprint, so concurrent same-config requests share one
// fetch while a config edit isn't blocked behind the old config's request.
const inFlight = (g.__ctrlcenterMonitorRefresh ??= new Map());

function refresh(
  id: MonitorServiceId,
  key: string,
  fetcher: () => Promise<unknown>
): Promise<void> {
  const flightKey = `${id}|${key}`;
  const running = inFlight.get(flightKey);
  if (running) return running;
  const run = (async () => {
    try {
      const data = await fetcher();
      cache.set(id, { key, data, error: null, at: Date.now() });
    } catch (e) {
      const reason =
        e instanceof ServiceError ? e.message : "Snapshot failed";
      if (!(e instanceof ServiceError)) {
        log.warn("monitor snapshot error", { service: id, reason: errorReason(e) });
      }
      const prior = cache.get(id);
      cache.set(id, {
        key,
        // Keep serving the last good data only if it came from this same
        // config — an edited URL's stale data would be the wrong service's.
        data: prior && prior.key === key ? prior.data : null,
        error: reason,
        at: Date.now(),
      });
    } finally {
      inFlight.delete(flightKey);
    }
  })();
  inFlight.set(flightKey, run);
  return run;
}

async function serviceStatus<T>(
  id: MonitorServiceId,
  configured: boolean,
  key: string,
  fetcher: () => Promise<T>
): Promise<ServiceStatus<T>> {
  if (!configured) {
    cache.delete(id);
    return { configured: false, data: null, error: null, at: null };
  }
  const entry = cache.get(id);
  if (!entry || entry.key !== key) {
    await refresh(id, key, fetcher);
  } else if (Date.now() - entry.at >= MONITOR_TTL_MS) {
    void refresh(id, key, fetcher);
  }
  const now = cache.get(id);
  return {
    configured: true,
    data: (now?.data as T) ?? null,
    error: now?.error ?? null,
    at: now?.at ?? null,
  };
}

const isConfigured = (i: { enabled: boolean; url: string }): boolean =>
  i.enabled && i.url.trim() !== "";

export async function getMonitorSnapshot(
  integrations: IntegrationsConfig
): Promise<MonitorSnapshot> {
  const { qbittorrent: qb, sonarr, radarr } = integrations;
  const [qbStatus, sonarrStatus, radarrStatus] = await Promise.all([
    serviceStatus(
      "qbittorrent",
      isConfigured(qb),
      JSON.stringify([qb.url, qb.username, qb.password]),
      () => getQbittorrentSnapshot(qb)
    ),
    serviceStatus(
      "sonarr",
      isConfigured(sonarr),
      JSON.stringify([sonarr.url, sonarr.apiKey]),
      () => getArrSnapshot("sonarr", sonarr)
    ),
    serviceStatus(
      "radarr",
      isConfigured(radarr),
      JSON.stringify([radarr.url, radarr.apiKey]),
      () => getArrSnapshot("radarr", radarr)
    ),
  ]);
  return { qbittorrent: qbStatus, sonarr: sonarrStatus, radarr: radarrStatus };
}
