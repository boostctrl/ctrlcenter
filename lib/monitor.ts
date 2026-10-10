// The shared poll/cache behind the private Monitor dashboard (#189, #207):
// one snapshot per integration, cached stale-while-revalidate so however many
// admin tabs are polling, each service sees at most one in-flight request and
// one fetch per TTL window. Mirrors the RSS feed cache (lib/feed.ts): a fresh
// entry is served as-is, an expired one is served immediately with the
// refresh running behind the response, only a cold cache blocks, and a failed
// refresh keeps the last good data (stale-on-failure) with the error beside
// it. Built on the shared lib/swr-cache.ts.
//
// Everything here is admin-only data — the /api/monitor route and the
// /admin/monitor page are the only consumers, both behind the session gate.

import type { Integration } from "./schema";
import {
  SERVICES,
  isServiceConfigured,
  serviceFingerprint,
  type ServiceId,
  type ServiceSnapshotMap,
} from "./services/registry";
import { integrationLabels } from "./services/ids";
import { resolveIntegration } from "./services/resolve";
import { ServiceError } from "./services/http";
import { log, errorReason } from "./log";
import { swrCache, type SwrEntry } from "./swr-cache";

// One integration's slice of the dashboard: the last good snapshot when there is
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

// One integration on the dashboard (#300): which one, its type, what to call
// it, and its status. A union over the types, so narrowing on `type` narrows
// `data` to that type's snapshot.
export type MonitorEntry = {
  [K in ServiceId]: { id: string; type: K; label: string } & ServiceStatus<ServiceSnapshotMap[K]>;
}[ServiceId];

// Every integration, in the configured order.
export type MonitorSnapshot = MonitorEntry[];

// Snappier than the feed cache's 5 minutes — this page is "what's happening
// right now" — while still collapsing a burst of open tabs into one fetch.
const MONITOR_TTL_MS = 30_000;

// Keyed `${integration id}|${fingerprint}` — the fingerprint of the config
// that produced the entry — so an edit invalidates immediately instead of serving the old
// target's data for another TTL. The error rides beside the data, so a failed
// refresh keeps serving the last good snapshot (stale-on-failure) and says why.
type MonitorValue = { data: unknown; error: string | null };
const snapshots = swrCache<MonitorValue>("monitor", MONITOR_TTL_MS);

const servicePrefix = (id: string) => `${id}|`;

// Drop every cached snapshot for an integration. Deleting through the cache also
// fences off any refresh still running for it, so a fetch begun before a
// config change or a dashboard action can't write its stale result back
// (#211).
function forgetService(id: string, keep?: string): void {
  snapshots.deleteWhere((k) => k.startsWith(servicePrefix(id)) && k !== keep);
}

async function loadSnapshot(
  id: string,
  fetcher: () => Promise<unknown>,
  prev: SwrEntry<MonitorValue> | undefined
): Promise<MonitorValue> {
  try {
    return { data: await fetcher(), error: null };
  } catch (e) {
    const reason = e instanceof ServiceError ? e.message : "Snapshot failed";
    if (!(e instanceof ServiceError)) {
      log.warn("monitor snapshot error", { integration: id, reason: errorReason(e) });
    }
    // `prev` is this same key, i.e. the same config, so its data is still
    // the right service's.
    return { data: prev?.value.data ?? null, error: reason };
  }
}

async function serviceStatus<T>(
  id: string,
  configured: boolean,
  enabled: boolean,
  urlSet: boolean,
  actionsAllowed: boolean,
  key: string,
  fetcher: () => Promise<T>
): Promise<ServiceStatus<T>> {
  if (!configured) {
    forgetService(id);
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
  const cacheKey = servicePrefix(id) + key;
  // A previous config's snapshots are the wrong target's now.
  forgetService(id, cacheKey);
  const now = await snapshots.get(cacheKey, (prev) =>
    loadSnapshot(id, fetcher, prev)
  );
  return {
    configured: true,
    enabled,
    urlSet,
    actionsAllowed,
    data: (now?.data as T) ?? null,
    error: now?.error ?? null,
    at: snapshots.peek(cacheKey)?.at ?? null,
  };
}

// One integration's status via its type's registry entry.
function statusFor(integration: Integration): Promise<ServiceStatus<unknown>> {
  const configured = isServiceConfigured(integration);
  return serviceStatus(
    integration.id,
    configured,
    // The enable toggle and whether a URL is present — the two bits `configured`
    // (their AND) folds together, kept apart so a disabled integration reads
    // differently from a never-set-up one on the cockpit (#208).
    integration.enabled === true,
    integration.url.trim() !== "",
    // Actions are live only when the integration is both configured and opted
    // in; the types without action support never render a control for it.
    configured && integration.allowActions === true,
    serviceFingerprint(integration),
    (): Promise<unknown> => SERVICES[integration.type].snapshot(resolveIntegration(integration))
  );
}

// Drop an integration's cached snapshot so the next read fetches fresh data.
// Called right after a write action (#201/#202/#203): otherwise the card's
// post-action refetch would serve the still-cached snapshot for up to a TTL,
// so a just-paused torrent or stopped container would linger.
export function invalidateService(id: string): void {
  forgetService(id);
}

export async function getMonitorSnapshot(integrations: Integration[]): Promise<MonitorSnapshot> {
  const labels = integrationLabels(integrations);
  // The type and its status are correlated by construction (statusFor runs
  // the integration's own type's snapshot); the cast restores the union.
  return Promise.all(
    integrations.map(
      async (i) =>
        ({ id: i.id, type: i.type, label: labels[i.id], ...(await statusFor(i)) }) as MonitorEntry
    )
  );
}
