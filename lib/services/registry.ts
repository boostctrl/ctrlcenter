// The server-side service registry (#212, #300): everything the monitor cache
// (lib/monitor.ts), the detail pages (lib/monitor-detail.ts) and the
// test-connection route need to drive one integration type, in one entry per
// type. Typed as a complete record over ServiceId, so a type missing its entry
// fails the typecheck. Each entry takes resolved credentials
// (lib/services/resolve.ts); the clients never read the environment.

import { SERVICE_IDS, SERVICE_LABELS, SERVICE_META, type ServiceId } from "./ids";
import {
  getQbittorrentSnapshot,
  probeQbittorrent,
  type QbittorrentSnapshot,
} from "./qbittorrent";
import { getArrSnapshot, probeArr, type ArrSnapshot } from "./arr";
import {
  getAdguardSnapshot,
  probeAdguard,
  type AdguardSnapshot,
} from "./adguard";
import {
  getTautulliSnapshot,
  probeTautulli,
  type TautulliSnapshot,
} from "./tautulli";
import { getSeerrSnapshot, probeSeerr, type SeerrSnapshot } from "./seerr";
import {
  getPortainerSnapshot,
  probePortainer,
  type PortainerSnapshot,
} from "./portainer";
import {
  getTruenasSnapshot,
  probeTruenas,
  type TruenasSnapshot,
} from "./truenas";
import { getUnifiSnapshot, probeUnifi, type UnifiSnapshot } from "./unifi";
import type { ProbeResult } from "./http";

import {
  getQbittorrentDetail,
  type QbittorrentDetail,
} from "./qbittorrent";
import { getTautulliDetail, type TautulliDetail } from "./tautulli";
import { getArrDetail } from "./arr";
import { getUnifiDetail, type UnifiDetail } from "./unifi";
import type { ResolvedIntegration } from "./resolve";

export { SERVICE_IDS, SERVICE_LABELS, SERVICE_META, type ServiceId };

// What each service's snapshot fetcher yields — the payload its Monitor card
// receives. Client components may import this with `import type` (erased at
// build time); a value import would pull the service clients into the bundle.
export type ServiceSnapshotMap = {
  qbittorrent: QbittorrentSnapshot;
  sonarr: ArrSnapshot;
  radarr: ArrSnapshot;
  adguard: AdguardSnapshot;
  tautulli: TautulliSnapshot;
  seerr: SeerrSnapshot;
  portainer: PortainerSnapshot;
  truenas: TruenasSnapshot;
  unifi: UnifiSnapshot;
};

// The superset of credential fields a Test-connection probe can carry
// (mirrors the /api/monitor/test body); each service reads the ones it
// authenticates with and ignores the rest.
export type ProbeFields = {
  url: string;
  username: string;
  password: string;
  apiKey: string;
  allowInsecureTls: boolean;
};

// Each type's detail payload (#208): the snapshot type, except the types with
// a richer detail read — qBittorrent (uncapped list + session totals),
// Tautulli (activity + watch history) and UniFi.
export type DetailData = Omit<ServiceSnapshotMap, "qbittorrent" | "tautulli" | "unifi"> & {
  qbittorrent: QbittorrentDetail;
  tautulli: TautulliDetail;
  unifi: UnifiDetail;
};

export type ServiceDefinition<T, D> = {
  // Fetch the Monitor tile's data.
  snapshot: (cfg: ResolvedIntegration) => Promise<T>;
  // The detail page's data; a type without a richer read reuses its snapshot.
  detail: (cfg: ResolvedIntegration) => Promise<D>;
  // Fresh reachability check with as-typed (unsaved) form values.
  probe: (fields: ProbeFields) => Promise<ProbeResult>;
};

export const SERVICES: {
  [K in ServiceId]: ServiceDefinition<ServiceSnapshotMap[K], DetailData[K]>;
} = {
  qbittorrent: {
    snapshot: (cfg) => getQbittorrentSnapshot(cfg),
    detail: (cfg) => getQbittorrentDetail(cfg),
    probe: ({ url, username, password }) => probeQbittorrent({ url, username, password }),
  },
  sonarr: {
    snapshot: (cfg) => getArrSnapshot("sonarr", cfg),
    detail: (cfg) => getArrDetail("sonarr", cfg),
    probe: ({ url, apiKey }) => probeArr("sonarr", { url, apiKey }),
  },
  radarr: {
    snapshot: (cfg) => getArrSnapshot("radarr", cfg),
    detail: (cfg) => getArrDetail("radarr", cfg),
    probe: ({ url, apiKey }) => probeArr("radarr", { url, apiKey }),
  },
  adguard: {
    snapshot: (cfg) => getAdguardSnapshot(cfg),
    detail: (cfg) => getAdguardSnapshot(cfg),
    probe: ({ url, username, password }) => probeAdguard({ url, username, password }),
  },
  tautulli: {
    snapshot: (cfg) => getTautulliSnapshot(cfg),
    detail: (cfg) => getTautulliDetail(cfg),
    probe: ({ url, apiKey }) => probeTautulli({ url, apiKey }),
  },
  seerr: {
    snapshot: (cfg) => getSeerrSnapshot(cfg),
    detail: (cfg) => getSeerrSnapshot(cfg),
    probe: ({ url, apiKey }) => probeSeerr({ url, apiKey }),
  },
  portainer: {
    snapshot: (cfg) => getPortainerSnapshot(cfg),
    detail: (cfg) => getPortainerSnapshot(cfg),
    probe: ({ url, apiKey }) => probePortainer({ url, apiKey }),
  },
  truenas: {
    snapshot: (cfg) => getTruenasSnapshot(cfg),
    detail: (cfg) => getTruenasSnapshot(cfg),
    probe: ({ url, apiKey }) => probeTruenas({ url, apiKey }),
  },
  unifi: {
    snapshot: (cfg) => getUnifiSnapshot(cfg),
    detail: (cfg) => getUnifiDetail(cfg),
    probe: ({ url, username, password, allowInsecureTls }) =>
      probeUnifi({ url, username, password, allowInsecureTls }),
  },
};

// An integration is configured when it's enabled and has a URL. An
// unconfigured one renders as a set-up hint, never as an error.
export function isServiceConfigured(cfg: {
  enabled: boolean;
  url: string;
}): boolean {
  return cfg.enabled && cfg.url.trim() !== "";
}

// Cache fingerprint of the config that produced a snapshot: every field
// except the ones that don't change the target — `enabled`, `allowActions`
// and the display name — so an edited URL or credential invalidates the cached data immediately (it
// may belong to a different target) while toggling a service off and on, or
// turning actions on and off, doesn't discard still-valid data. Keys are sorted
// so property order can't fake a config change.
const NON_TARGET_FIELDS = new Set(["enabled", "allowActions", "name"]);
export function serviceFingerprint(cfg: object): string {
  return JSON.stringify(
    Object.entries(cfg)
      .filter(([key]) => !NON_TARGET_FIELDS.has(key))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
}
