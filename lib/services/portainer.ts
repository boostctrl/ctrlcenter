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
  serviceRequest,
  serviceJson,
  runProbe,
  type ProbeResult,
} from "./http";
import { resolveSecret } from "../secrets";
import { log, hostOf, errorReason } from "../log";

export type PortainerConfig = { url: string; apiKey: string };

// The API key can come from the environment instead of config.yaml, same
// convention as the other integrations.
export function resolvePortainerApiKey(cfg: { apiKey: string }): string {
  return resolveSecret("CTRLCENTER_PORTAINER_KEY", cfg.apiKey);
}

export type PortainerEndpoint = {
  // The environment id — what the container drill-down and actions (#203)
  // address (/api/endpoints/{id}/docker/...).
  id: number;
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
  Id?: number;
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
      id: typeof e.Id === "number" ? e.Id : 0,
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

// --- Container drill-down + actions (#203) ---
//
// The snapshot is environment-level (container tallies) — deliberately, so the
// 30s poll stays cheap. Acting on a container needs its id, so the card fetches
// one environment's container list on demand through the endpoints below, all
// admin-gated and behind the allowActions opt-in (lib/services/guard.ts).

export type PortainerContainer = {
  // The Docker container id — what start/stop/restart and the log tail target.
  id: string;
  name: string;
  // Docker's lifecycle state: running | exited | paused | created | restarting.
  state: string;
  // Human status line ("Up 2 hours", "Exited (0) 5 minutes ago").
  status: string;
};

// The drill-down lists a whole environment, so cap it — a big host can run
// hundreds of containers, and the card is a control surface, not an inventory.
export const PORTAINER_CONTAINER_CAP = 100;

// How much log tail to pull and how much to keep. tail bounds it at the source;
// the byte cap is a backstop against a single enormous line.
export const PORTAINER_LOG_TAIL = 200;
export const PORTAINER_LOG_MAX_BYTES = 256 * 1024;

type RawContainer = {
  Id?: string;
  Names?: string[];
  State?: string;
  Status?: string;
};

// Exported for the unit tests: fold Docker's container list into the card rows.
export function mapContainers(raw: unknown): PortainerContainer[] {
  const list = Array.isArray(raw) ? (raw as RawContainer[]) : [];
  return list.slice(0, PORTAINER_CONTAINER_CAP).map((c) => ({
    id: typeof c.Id === "string" ? c.Id : "",
    // Docker names come as ["/my-container"]; drop the leading slash.
    name: (c.Names?.[0] ?? "").replace(/^\//, "").trim() || "(unnamed)",
    state: typeof c.State === "string" ? c.State : "",
    status: typeof c.Status === "string" ? c.Status : "",
  }));
}

// One environment's containers, via Portainer's Docker API proxy.
export async function listContainers(
  cfg: PortainerConfig,
  endpointId: number
): Promise<PortainerContainer[]> {
  return mapContainers(
    await portainerJson<RawContainer[]>(
      cfg,
      `/api/endpoints/${endpointId}/docker/containers/json?all=1`
    )
  );
}

// start / stop / restart, proxied to Docker. Docker answers 204 on success and
// 304 when the container is already in the target state (start an already-up
// container) — both are success. 401/403 surface as an invalid key.
async function containerCommand(
  cfg: PortainerConfig,
  endpointId: number,
  containerId: string,
  action: "start" | "stop" | "restart"
): Promise<void> {
  const base = serviceBase(cfg.url);
  const { res } = await serviceRequest(
    `${base}/api/endpoints/${endpointId}/docker/containers/${containerId}/${action}`,
    { method: "POST", headers: { "X-API-Key": resolvePortainerApiKey(cfg) } }
  );
  if (res.status === 401 || res.status === 403) {
    throw new ServiceError("Invalid API key");
  }
  if (!res.ok && res.status !== 304) throw new ServiceError(`HTTP ${res.status}`);
}

export function startContainer(cfg: PortainerConfig, endpointId: number, id: string) {
  return containerCommand(cfg, endpointId, id, "start");
}
export function stopContainer(cfg: PortainerConfig, endpointId: number, id: string) {
  return containerCommand(cfg, endpointId, id, "stop");
}
export function restartContainer(cfg: PortainerConfig, endpointId: number, id: string) {
  return containerCommand(cfg, endpointId, id, "restart");
}

// Docker multiplexes a non-TTY container's logs: each chunk is framed with an
// 8-byte header [stream(1), 0, 0, 0, size(4, big-endian)]. Walk the frames and
// concatenate their payloads. A TTY container streams raw text with no frames,
// so a header that isn't a valid frame (stream byte > 2 or the reserved bytes
// non-zero) means the rest is raw — return it verbatim. Exported for testing.
export function demuxDockerLog(buf: Buffer): string {
  const out: Buffer[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const stream = buf[i];
    if (stream > 2 || buf[i + 1] !== 0 || buf[i + 2] !== 0 || buf[i + 3] !== 0) {
      // Not framed (a TTY container, or unexpected data) — the rest is raw.
      out.push(buf.subarray(i));
      return Buffer.concat(out).toString("utf8");
    }
    const size = buf.readUInt32BE(i + 4);
    const end = i + 8 + size;
    out.push(buf.subarray(i + 8, Math.min(end, buf.length)));
    i = end;
  }
  // A trailing run shorter than a full header is raw tail; keep it.
  if (i < buf.length) out.push(buf.subarray(i));
  return Buffer.concat(out).toString("utf8");
}

// A read-only tail of one container's logs. Reads raw bytes (not the utf8 text
// serviceRequest yields) so the multiplexed frame headers survive to be
// demuxed, timeout-bounded, and capped. No exec, no console — logs only.
export async function containerLogs(
  cfg: PortainerConfig,
  endpointId: number,
  containerId: string
): Promise<string> {
  const base = serviceBase(cfg.url);
  const url =
    `${base}/api/endpoints/${endpointId}/docker/containers/${containerId}` +
    `/logs?stdout=1&stderr=1&timestamps=0&tail=${PORTAINER_LOG_TAIL}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: { "X-API-Key": resolvePortainerApiKey(cfg) },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new ServiceError("Invalid API key");
    }
    if (!res.ok) throw new ServiceError(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const capped = bytes.subarray(Math.max(0, bytes.length - PORTAINER_LOG_MAX_BYTES));
    return demuxDockerLog(capped);
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    log.warn("portainer logs fetch error", {
      host: hostOf(base),
      reason: errorReason(e),
    });
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new ServiceError(aborted ? "Timed out" : "Couldn't connect");
  } finally {
    clearTimeout(timer);
  }
}
