// The server-side service registry (#212): everything the monitor cache
// (lib/monitor.ts) and the test-connection route need to drive one
// integration, in one entry per service. Typed as a complete record over
// ServiceId, so a service missing its entry — or its integrationsSchema slice
// — fails the typecheck; the hand-kept per-service switches this replaces
// failed silently instead (a configured service just never polled).

import type { IntegrationsConfig } from "../schema";
import { SERVICE_IDS, SERVICE_LABELS, type ServiceId } from "./ids";
import {
  getQbittorrentSnapshot,
  probeQbittorrent,
  type QbittorrentSnapshot,
} from "./qbittorrent";
import { getArrSnapshot, probeArr, type ArrSnapshot } from "./arr";
import type { ProbeResult } from "./http";

export { SERVICE_IDS, SERVICE_LABELS, type ServiceId };

// What each service's snapshot fetcher yields — the payload its Monitor card
// receives. Client components may import this with `import type` (erased at
// build time); a value import would pull the service clients into the bundle.
export type ServiceSnapshotMap = {
  qbittorrent: QbittorrentSnapshot;
  sonarr: ArrSnapshot;
  radarr: ArrSnapshot;
};

// The superset of credential fields a Test-connection probe can carry
// (mirrors the /api/monitor/test body); each service reads the ones it
// authenticates with and ignores the rest.
export type ProbeFields = {
  url: string;
  username: string;
  password: string;
  apiKey: string;
};

export type ServiceDefinition<C, T> = {
  // Fetch the card's data with the saved config.
  snapshot: (cfg: C) => Promise<T>;
  // Fresh reachability check with as-typed (unsaved) form values.
  probe: (fields: ProbeFields) => Promise<ProbeResult>;
};

export const SERVICES: {
  [K in ServiceId]: ServiceDefinition<
    IntegrationsConfig[K],
    ServiceSnapshotMap[K]
  >;
} = {
  qbittorrent: {
    snapshot: (cfg) => getQbittorrentSnapshot(cfg),
    probe: ({ url, username, password }) =>
      probeQbittorrent({ url, username, password }),
  },
  sonarr: {
    snapshot: (cfg) => getArrSnapshot("sonarr", cfg),
    probe: ({ url, apiKey }) => probeArr("sonarr", { url, apiKey }),
  },
  radarr: {
    snapshot: (cfg) => getArrSnapshot("radarr", cfg),
    probe: ({ url, apiKey }) => probeArr("radarr", { url, apiKey }),
  },
};

// A service is configured when it's enabled and has a URL — every integration
// carries both fields (integrationsSchema). Unconfigured services render as a
// set-up hint, never as an error.
export function isServiceConfigured(cfg: {
  enabled: boolean;
  url: string;
}): boolean {
  return cfg.enabled && cfg.url.trim() !== "";
}

// Cache fingerprint of the config that produced a snapshot: every field
// except `enabled`, so an edited URL or credential invalidates the cached
// data immediately (it may belong to a different target) while toggling a
// service off and on doesn't discard still-valid data. Keys are sorted so
// property order can't fake a config change.
export function serviceFingerprint(cfg: object): string {
  return JSON.stringify(
    Object.entries(cfg)
      .filter(([key]) => key !== "enabled")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
}
