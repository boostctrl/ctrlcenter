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
  SERVICE_IDS,
  SERVICES,
  isServiceConfigured,
  serviceFingerprint,
  type ServiceId,
  type ServiceSnapshotMap,
} from "./services/registry";
import { ServiceError } from "./services/http";
import { log, errorReason } from "./log";

// One service's slice of the dashboard: the last good snapshot when there is
// one, the latest failure when there isn't — or both, when a refresh fails
// behind stale data. `configured` = enabled with a URL set; an unconfigured
// service renders as a set-up hint, not an error.
export type ServiceStatus<T> = {
  configured: boolean;
  // The two bits `configured` collapses, so the Monitor cockpit (#208) can tell
  // a *disabled* integration (has a URL, toggle off) from one that was *never
  // set up* (no URL) and render each its own graceful-degradation tile instead
  // of one undifferentiated "not configured" hole. Admin-only booleans — no URL,
  // no credentials — on an already session-gated surface, the same category as
  // `configured` itself, so nothing sensitive crosses to the browser.
  enabled: boolean;
  urlSet: boolean;
  // Whether write actions are turned on for this integration (#201/#202/#203):
  // configured AND its allowActions opt-in is set. The card renders its action
  // controls only when true — the flag itself, not the credentials, is all the
  // client needs to know, so nothing sensitive crosses to the browser.
  actionsAllowed: boolean;
  data: T | null;
  error: string | null;
  // When `data`/`error` was recorded (epoch ms); null when never fetched.
  at: number | null;
};

export type MonitorSnapshot = {
  [K in ServiceId]: ServiceStatus<ServiceSnapshotMap[K]>;
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
  __ctrlcenterMonitorCache?: Map<ServiceId, CacheEntry>;
  __ctrlcenterMonitorRefresh?: Map<string, Promise<void>>;
  __ctrlcenterMonitorLatest?: Map<ServiceId, string>;
};
const cache = (g.__ctrlcenterMonitorCache ??= new Map());
// Keyed by service + fingerprint, so concurrent same-config requests share one
// fetch while a config edit isn't blocked behind the old config's request.
const inFlight = (g.__ctrlcenterMonitorRefresh ??= new Map());
// The most recently requested fingerprint per service. Two quick edits (A then
// B) within one fetch window run concurrent refreshes for the same service; a
// completed refresh only writes if its key is still the latest, so a slow A can
// no longer clobber B's fresh entry and force a redundant blocking refetch
// (#211).
const latestKey = (g.__ctrlcenterMonitorLatest ??= new Map());

function refresh(
  id: ServiceId,
  key: string,
  fetcher: () => Promise<unknown>
): Promise<void> {
  const flightKey = `${id}|${key}`;
  const running = inFlight.get(flightKey);
  if (running) return running;
  latestKey.set(id, key);
  const run = (async () => {
    try {
      const data = await fetcher();
      // Drop the write if a newer config superseded this one while it ran.
      if (latestKey.get(id) === key) {
        cache.set(id, { key, data, error: null, at: Date.now() });
      }
    } catch (e) {
      const reason =
        e instanceof ServiceError ? e.message : "Snapshot failed";
      if (!(e instanceof ServiceError)) {
        log.warn("monitor snapshot error", { service: id, reason: errorReason(e) });
      }
      if (latestKey.get(id) === key) {
        const prior = cache.get(id);
        cache.set(id, {
          key,
          // Keep serving the last good data only if it came from this same
          // config — an edited URL's stale data would be the wrong service's.
          data: prior && prior.key === key ? prior.data : null,
          error: reason,
          at: Date.now(),
        });
      }
    } finally {
      inFlight.delete(flightKey);
    }
  })();
  inFlight.set(flightKey, run);
  return run;
}

async function serviceStatus<T>(
  id: ServiceId,
  configured: boolean,
  enabled: boolean,
  urlSet: boolean,
  actionsAllowed: boolean,
  key: string,
  fetcher: () => Promise<T>
): Promise<ServiceStatus<T>> {
  if (!configured) {
    cache.delete(id);
    // Also forget the latest key, so an in-flight refresh that started before
    // the service was disabled can't write its result back in.
    latestKey.delete(id);
    return {
      configured: false,
      enabled,
      urlSet,
      actionsAllowed: false,
      data: null,
      error: null,
      at: null,
    };
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
    enabled,
    urlSet,
    actionsAllowed,
    data: (now?.data as T) ?? null,
    error: now?.error ?? null,
    at: now?.at ?? null,
  };
}

// One service's status via its registry entry. Generic over the id so the
// config slice, fetcher, and payload types stay correlated.
function statusFor<K extends ServiceId>(
  id: K,
  integrations: IntegrationsConfig
): Promise<ServiceStatus<ServiceSnapshotMap[K]>> {
  const cfg = integrations[id];
  const configured = isServiceConfigured(cfg);
  return serviceStatus(
    id,
    configured,
    // The enable toggle and whether a URL is present — the two bits `configured`
    // (their AND) folds together, kept apart so a disabled service reads
    // differently from a never-set-up one on the cockpit (#208).
    cfg.enabled === true,
    cfg.url.trim() !== "",
    // Actions are live only when the integration is both configured and opted
    // in. Every integration carries allowActions (lib/schema.ts); the services
    // without action support just never have a control to render it. `=== true`
    // keeps the flag a strict boolean even if a hand-edited config omits it.
    configured && cfg.allowActions === true,
    serviceFingerprint(cfg),
    () => SERVICES[id].snapshot(cfg)
  );
}

// Drop a service's cached snapshot so the next read fetches fresh data. Called
// right after a write action (#201/#202/#203): otherwise the card's post-action
// refetch would serve the still-cached snapshot for up to a TTL, so a
// just-paused torrent or stopped container would linger. The next getMonitor
// snapshot for this service then blocks on a cold cache and reflects the change.
export function invalidateService(id: ServiceId): void {
  cache.delete(id);
  // Forget the latest key too, so an in-flight refresh begun before the action
  // can't write its now-stale result back in.
  latestKey.delete(id);
}

export async function getMonitorSnapshot(
  integrations: IntegrationsConfig
): Promise<MonitorSnapshot> {
  const entries = await Promise.all(
    SERVICE_IDS.map(async (id) => [id, await statusFor(id, integrations)] as const)
  );
  // Assembled by mapping the registry ids, so every service is present by
  // construction; the cast restores the per-service payload types the zip
  // through Object.fromEntries loses.
  return Object.fromEntries(entries) as MonitorSnapshot;
}
