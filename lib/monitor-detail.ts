// The data plane for the per-service Monitor detail pages (#208): given a
// service id, fetch the richer "detail" payload its detail page renders — the
// full lists, extra fields, and session/history the glance card sheds. Shared
// by the detail route (app/api/monitor/[id]) and the detail page's server
// render, both admin-gated.
//
// Detail is a live read, not the SWR-cached snapshot: a detail page is open one
// at a time and polls at the same cadence as the cockpit, so a direct per-poll
// fetch is fine. (qBittorrent rides its shared maindata sync state, so it adds
// no extra load at all.) Services gain a detail view one phase at a time — a
// service absent from DETAIL_SERVICES has no detail page yet and its card stays
// a full card.

import type { IntegrationsConfig } from "./schema";
import {
  isServiceConfigured,
  SERVICE_IDS,
  SERVICES,
  type ServiceId,
  type ServiceSnapshotMap,
} from "./services/registry";
import { ServiceError } from "./services/http";
import { log, errorReason } from "./log";
import {
  getQbittorrentDetail,
  type QbittorrentDetail,
} from "./services/qbittorrent";
import { getTautulliDetail, type TautulliDetail } from "./services/tautulli";
import { getArrDetail } from "./services/arr";

// Every service has a detail page. Most reuse their snapshot data (the same the
// card renders) as a "basic" detail; qBittorrent has a richer payload. Later
// phases can swap any basic entry for a richer per-service fetch + payload.
export const DETAIL_SERVICES = SERVICE_IDS;
export type DetailServiceId = ServiceId;

export function isDetailService(id: string): id is DetailServiceId {
  return (DETAIL_SERVICES as readonly string[]).includes(id);
}

// Each service's detail payload — the snapshot type, except the services with a
// richer detail read: qBittorrent (uncapped list + session totals) and Tautulli
// (activity + recent watch history). Sonarr/Radarr and AdGuard keep the snapshot
// type — their detail read just fills it more fully (a deeper history, the query
// series) without changing its shape.
export type DetailData = Omit<ServiceSnapshotMap, "qbittorrent" | "tautulli"> & {
  qbittorrent: QbittorrentDetail;
  tautulli: TautulliDetail;
};

// One service's detail read: the service id, whether its write actions are on
// (the same `allowActions` opt-in the card gates on — the flag, not the
// credentials, crosses to the browser), its payload (null when unreachable), and
// the error (null on success) — the same data/error shape the snapshot uses, so
// the detail body can show a calm offline state.
export type DetailResultFor<K extends DetailServiceId> = {
  service: K;
  actionsAllowed: boolean;
  data: DetailData[K] | null;
  error: string | null;
};

// The discriminated union over every service, so switching on `service` narrows
// `data` to that service's payload (what the per-service detail body needs).
export type DetailResult = {
  [K in DetailServiceId]: DetailResultFor<K>;
}[DetailServiceId];

// Fetch one configured service's detail. Returns null only when the service
// isn't configured (the page 404s); an unreachable service resolves to a result
// carrying the error, never throws. The `as DetailResult` casts bridge the
// runtime id to the discriminated union — the id and data are correlated by
// construction (fetchDetail is generic over the id).
export async function getServiceDetail(
  id: DetailServiceId,
  integrations: IntegrationsConfig
): Promise<DetailResult | null> {
  const cfg = integrations[id];
  if (!isServiceConfigured(cfg)) return null;
  const actionsAllowed = cfg.allowActions === true;
  try {
    const data = await fetchDetail(id, integrations);
    return { service: id, actionsAllowed, data, error: null } as DetailResult;
  } catch (e) {
    const reason = e instanceof ServiceError ? e.message : "Detail failed";
    if (!(e instanceof ServiceError)) {
      log.warn("monitor detail error", { service: id, reason: errorReason(e) });
    }
    return { service: id, actionsAllowed, data: null, error: reason } as DetailResult;
  }
}

// The per-service dispatch. `DetailData` being a complete record over
// DetailServiceId keeps the payload types correlated; this switch maps each id
// to its fetcher (the cast restores the per-id type the union return loses). A
// service in DETAIL_SERVICES without a case here throws — caught by
// getServiceDetail as an error result rather than a crash.
function fetchDetail<K extends DetailServiceId>(
  id: K,
  integrations: IntegrationsConfig
): Promise<DetailData[K]> {
  // A handful of services fetch a richer detail payload; the rest fall through
  // to their registry snapshot (the same data their card renders).
  switch (id) {
    case "qbittorrent":
      return getQbittorrentDetail(integrations.qbittorrent) as Promise<
        DetailData[K]
      >;
    case "tautulli":
      return getTautulliDetail(integrations.tautulli) as Promise<DetailData[K]>;
    case "sonarr":
      return getArrDetail("sonarr", integrations.sonarr) as Promise<
        DetailData[K]
      >;
    case "radarr":
      return getArrDetail("radarr", integrations.radarr) as Promise<
        DetailData[K]
      >;
    default:
      return SERVICES[id].snapshot(integrations[id]) as Promise<DetailData[K]>;
  }
}

// Re-exported for callers that validate a raw route param against the id union.
export type { ServiceId };
