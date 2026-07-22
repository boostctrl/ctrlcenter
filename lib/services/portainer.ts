// Typed client for the Portainer API (#197). Server-side only — calls happen
// inside admin-gated routes via the monitor cache, and the API key never
// reaches the browser. Portainer authenticates with an `X-API-Key` header.
//
// The card answers "are my containers up", across every environment Portainer
// manages — the health signal for the long tail of self-hosted apps that
// expose no useful API of their own. Portainer keeps a periodic snapshot of
// each environment, so the whole picture comes from one /api/endpoints call
// (no per-environment Docker round-trips).

import {
  ServiceError,
  serviceBase,
  serviceJson,
  runProbe,
  type ProbeResult,
} from "./http";
import { resolveSecret } from "../secrets";

export type PortainerConfig = { url: string; apiKey: string };

// The API key can come from the environment instead of config.yaml, same
// convention as the other integrations.
export function resolvePortainerApiKey(cfg: { apiKey: string }): string {
  return resolveSecret("CTRLCENTER_PORTAINER_KEY", cfg.apiKey);
}

export type PortainerEndpoint = {
  name: string;
  running: number;
  stopped: number;
  unhealthy: number;
  total: number;
  // False when Portainer holds no snapshot for the environment (agent down,
  // or a non-Docker environment) — the card greys it instead of showing 0/0.
  hasSnapshot: boolean;
};

export type PortainerSnapshot = {
  endpoints: PortainerEndpoint[];
  totals: { running: number; stopped: number; unhealthy: number; total: number };
};

export const PORTAINER_ENDPOINT_CAP = 8;

// --- Raw API shapes (only the fields the snapshot uses) ---

type RawEndpoint = {
  Name?: string;
  // Docker environments carry a periodic snapshot with the container tallies.
  Snapshots?: RawDockerSnapshot[];
};
type RawDockerSnapshot = {
  RunningContainerCount?: number;
  StoppedContainerCount?: number;
  HealthyContainerCount?: number;
  UnhealthyContainerCount?: number;
  TotalContainerCount?: number;
};

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;

// Exported for the unit tests: fold the endpoint list into the snapshot.
export function mapPortainerEndpoints(raw: unknown): PortainerSnapshot {
  const list = Array.isArray(raw) ? (raw as RawEndpoint[]) : [];
  const endpoints = list.slice(0, PORTAINER_ENDPOINT_CAP).map((e, i) => {
    const snap = e.Snapshots?.[0];
    const running = num(snap?.RunningContainerCount);
    const stopped = num(snap?.StoppedContainerCount);
    const unhealthy = num(snap?.UnhealthyContainerCount);
    const total = snap?.TotalContainerCount !== undefined
      ? num(snap.TotalContainerCount)
      : running + stopped;
    return {
      name: e.Name?.trim() || `Environment ${i + 1}`,
      running,
      stopped,
      unhealthy,
      total,
      hasSnapshot: snap !== undefined,
    };
  });
  const totals = endpoints.reduce(
    (acc, e) => ({
      running: acc.running + e.running,
      stopped: acc.stopped + e.stopped,
      unhealthy: acc.unhealthy + e.unhealthy,
      total: acc.total + e.total,
    }),
    { running: 0, stopped: 0, unhealthy: 0, total: 0 }
  );
  return { endpoints, totals };
}

async function portainerJson<T>(cfg: PortainerConfig, path: string): Promise<T> {
  const base = serviceBase(cfg.url);
  try {
    return await serviceJson<T>(`${base}${path}`, {
      headers: { "X-API-Key": resolvePortainerApiKey(cfg) },
    });
  } catch (e) {
    if (
      e instanceof ServiceError &&
      (e.message === "HTTP 401" || e.message === "HTTP 403")
    ) {
      throw new ServiceError("Invalid API key");
    }
    throw e;
  }
}

export async function getPortainerSnapshot(
  cfg: PortainerConfig
): Promise<PortainerSnapshot> {
  return mapPortainerEndpoints(
    await portainerJson<RawEndpoint[]>(cfg, "/api/endpoints")
  );
}

// Fresh reachability check for the admin's "Test connection" button. The
// /api/endpoints endpoint is key-gated, so a 200 proves the key; the count
// names what answered.
export async function probePortainer(
  cfg: PortainerConfig
): Promise<ProbeResult> {
  return runProbe("portainer", async () => {
    const list = await portainerJson<RawEndpoint[]>(cfg, "/api/endpoints");
    const n = Array.isArray(list) ? list.length : 0;
    return `Portainer — ${n} environment${n === 1 ? "" : "s"}`;
  });
}
