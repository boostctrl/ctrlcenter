// The 4-gate guard every integration write action passes before it runs
// (#201/#202/#203). The read-only monitor layer is admin-only twice over (the
// proxy prefix + a route session check); write actions add two more gates so a
// configured integration stays read-only until the admin explicitly opts in:
//
//   1. Proxy prefix — the action routes live under /api/monitor, already gated
//      in proxy.ts (ADMIN_PREFIXES). Enforced there, not here.
//   2. Route session re-check — isAdminRequest, mirroring app/api/monitor/route.
//   3. Integration configured — enabled with a URL set (isServiceConfigured).
//   4. allowActions opt-in — the per-integration write flag, default off.
//
// requireAction runs gates 2–4 (gate 1 is the proxy's) and hands the route the
// resolved config, or a typed failure it maps straight to a status + message.
// Server-side only — the credentials in the returned config never leave here.

import type { NextRequest } from "next/server";
import { isAdminRequest } from "../api-auth";
import { readConfigInternal } from "../config";
import type { IntegrationsConfig } from "../schema";
import type { ServiceId } from "./ids";
import { isServiceConfigured } from "./registry";

export type GuardFailure = { ok: false; status: number; error: string };
export type GuardSuccess<K extends ServiceId> = {
  ok: true;
  cfg: IntegrationsConfig[K];
};

// Resolve the action's target config after the gates, or the reason it was
// refused. Generic over the id so the returned config stays the service's own
// slice (qBittorrent's user/pass, Seerr's key, …). One config read covers the
// session check and the integration lookup.
export async function requireAction<K extends ServiceId>(
  request: NextRequest,
  service: K
): Promise<GuardSuccess<K> | GuardFailure> {
  const config = await readConfigInternal();
  if (!(await isAdminRequest(request, config.auth.passwordHash))) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const cfg = config.settings.integrations[service];
  // A disabled or URL-less integration has no target — 409, not 403: the
  // request isn't forbidden, there's just nothing configured to act on.
  if (!isServiceConfigured(cfg)) {
    return { ok: false, status: 409, error: "Integration not configured" };
  }
  // The opt-in gate: configured but read-only until the admin turns actions on.
  if (!cfg.allowActions) {
    return {
      ok: false,
      status: 403,
      error: "Actions are not enabled for this integration",
    };
  }
  return { ok: true, cfg };
}
