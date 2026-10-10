// The data plane for the per-service Monitor detail pages (#208): given a
// service id, fetch the richer "detail" payload its detail page renders — the
// full lists, extra fields, and session/history the glance card sheds. Shared
// by the detail route (app/api/monitor/[id]) and the detail page's server
// render, both admin-gated.
//
// Detail is a live read, not the SWR-cached snapshot: a detail page is open one
// at a time and polls at the same cadence as the cockpit, so a direct per-poll
// fetch is fine. (qBittorrent rides its shared maindata sync state, so it adds
// no extra load at all.)
//
// Integrations are instances since 3.0 (#300): a detail page is one
// integration's, addressed by its id; its type picks the fetch (the
// registry's `detail`) and the body.

import type { Integration } from "./schema";
import { isServiceConfigured, SERVICES, type DetailData, type ServiceId } from "./services/registry";
import { integrationLabels } from "./services/ids";
import { resolveIntegration } from "./services/resolve";
import { ServiceError } from "./services/http";
import { log, errorReason } from "./log";

export type { DetailData };

// One integration's detail read: which integration (id, type, label), whether
// its write actions are on (the same `allowActions` opt-in the card gates on —
// the flag, not the credentials, crosses to the browser), its payload (null
// when unreachable), and the error (null on success) — the same data/error
// shape the snapshot uses, so the detail body can show a calm offline state.
export type DetailResultFor<K extends ServiceId> = {
  id: string;
  service: K;
  label: string;
  actionsAllowed: boolean;
  data: DetailData[K] | null;
  error: string | null;
};

// The discriminated union over every type, so switching on `service` narrows
// `data` to that type's payload (what the per-type detail body needs).
export type DetailResult = {
  [K in ServiceId]: DetailResultFor<K>;
}[ServiceId];

// Fetch one configured integration's detail, by id (its Monitor URL, #300).
// Returns null when there's no such integration or it isn't configured (the
// page 404s); an unreachable one resolves to a result carrying the error,
// never throws.
export async function getServiceDetail(
  id: string,
  integrations: Integration[]
): Promise<DetailResult | null> {
  const integration = integrations.find((i) => i.id === id);
  if (!integration || !isServiceConfigured(integration)) return null;
  const base = {
    id,
    service: integration.type,
    label: integrationLabels(integrations)[id],
    actionsAllowed: integration.allowActions === true,
  };
  try {
    const data = await SERVICES[integration.type].detail(resolveIntegration(integration));
    return { ...base, data, error: null } as DetailResult;
  } catch (e) {
    const reason = e instanceof ServiceError ? e.message : "Detail failed";
    if (!(e instanceof ServiceError)) {
      log.warn("monitor detail error", { integration: id, reason: errorReason(e) });
    }
    return { ...base, data: null, error: reason } as DetailResult;
  }
}
