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
import { isServiceConfigured, type ServiceId } from "./services/registry";
import { ServiceError } from "./services/http";
import { log, errorReason } from "./log";
import {
  getQbittorrentDetail,
  type QbittorrentDetail,
} from "./services/qbittorrent";

// The services with a detail view so far. Add a service's id here (plus a
// DetailData entry and a getServiceDetail case) when its detail page ships.
export const DETAIL_SERVICES = ["qbittorrent"] as const;
export type DetailServiceId = (typeof DETAIL_SERVICES)[number];

export function isDetailService(id: string): id is DetailServiceId {
  return (DETAIL_SERVICES as readonly string[]).includes(id);
}

// Each detail service's payload type.
export type DetailData = {
  qbittorrent: QbittorrentDetail;
};

// One detail read: the service, whether its write actions are turned on (the
// same `allowActions` opt-in the card gates on — the flag, not the credentials,
// crosses to the browser), its payload (null when the service couldn't be
// reached), and the error (null on success) — the same data/error shape the
// snapshot uses, so the detail body can show a calm offline state.
export type DetailResult<K extends DetailServiceId = DetailServiceId> = {
  service: K;
  actionsAllowed: boolean;
  data: DetailData[K] | null;
  error: string | null;
};

// Fetch one configured service's detail. Returns null only when the service
// isn't configured (the page 404s); an unreachable service resolves to a result
// carrying the error, never throws.
export async function getServiceDetail<K extends DetailServiceId>(
  id: K,
  integrations: IntegrationsConfig
): Promise<DetailResult<K> | null> {
  const cfg = integrations[id];
  if (!isServiceConfigured(cfg)) return null;
  const actionsAllowed = cfg.allowActions === true;
  try {
    const data = await fetchDetail(id, integrations);
    return { service: id, actionsAllowed, data, error: null };
  } catch (e) {
    const reason = e instanceof ServiceError ? e.message : "Detail failed";
    if (!(e instanceof ServiceError)) {
      log.warn("monitor detail error", { service: id, reason: errorReason(e) });
    }
    return { service: id, actionsAllowed, data: null, error: reason };
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
  switch (id) {
    case "qbittorrent":
      return getQbittorrentDetail(integrations.qbittorrent) as Promise<
        DetailData[K]
      >;
    default:
      throw new Error(`no detail fetcher for ${id}`);
  }
}

// Re-exported for callers that validate a raw route param against the id union.
export type { ServiceId };
