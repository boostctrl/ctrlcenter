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
  serviceFetch,
  parseJson,
  throwForStatus,
  runProbe,
  type ProbeResult,
} from "./http";
import { streamCapped } from "../fetch-body";
import { log, hostOf, errorReason } from "../log";

export type PortainerConfig = { url: string; apiKey: string };

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

// Portainer rejects a bad API key with 401 or 403; both mean the same thing.
const KEY_ERRORS = { 401: "Invalid API key", 403: "Invalid API key" };

async function portainerJson<T>(cfg: PortainerConfig, path: string): Promise<T> {
  const base = serviceBase(cfg.url);
  const { res, text } = await serviceRequest(`${base}${path}`, {
    headers: { "X-API-Key": cfg.apiKey },
  });
  throwForStatus(res, KEY_ERRORS);
  return parseJson<T>(text);
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

// The shape a container id from the browser must have before it goes into a
// Docker API path (#379): the 64-hex id the container list returns, or the
// 12-hex short form. Docker would also take a name or any unique prefix, but
// the card only ever sends the list's own id, and a free-form string here is a
// path: "x/../../volumes/prune?" turned a start into a volume prune, and the
// log tail into a GET proxy for the rest of the Docker API.
export const CONTAINER_ID_PATTERN = /^(?:[0-9a-f]{12}|[0-9a-f]{64})$/;

// The drill-down lists a whole environment, so cap it — a big host can run
// hundreds of containers, and the card is a control surface, not an inventory.
export const PORTAINER_CONTAINER_CAP = 100;

// How much log tail to pull and how much to keep. `tail` bounds the line
// count at the source, not the bytes: a container writing enormous lines can
// answer with far more than the window, so the body is demuxed as it streams
// and only the last PORTAINER_LOG_MAX_BYTES of text are held (#427) — memory
// stays flat whatever the container writes, and a huge tail still shows its
// end. The window bounds what is held, not what is read, so the read itself
// has a hard cap too: PORTAINER_LOG_READ_MAX_BYTES on the raw bytes pulled,
// past which the tail is refused as "Response too large" like any oversized
// service response. Without it a body that never ends (a proxy that ignores
// `tail`, or streams as if `follow=1`) would hold the request, pulling bytes
// the whole time, until the service timeout cut it off. 32 MiB is eight times
// the service body cap and over a hundred times the window; a 200-line tail
// past it averages 160 KiB a line.
export const PORTAINER_LOG_TAIL = 200;
export const PORTAINER_LOG_MAX_BYTES = 256 * 1024;
export const PORTAINER_LOG_READ_MAX_BYTES = 32 * 1024 * 1024;

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
// container) — both are success. 401/403 surface as an invalid key. The id is
// encoded as well as checked by the routes (CONTAINER_ID_PATTERN, #379), so a
// "/" or "?" in it can't reshape the request even if a caller skips the check.
async function containerCommand(
  cfg: PortainerConfig,
  endpointId: number,
  containerId: string,
  action: "start" | "stop" | "restart"
): Promise<void> {
  const base = serviceBase(cfg.url);
  const id = encodeURIComponent(containerId);
  const { res } = await serviceRequest(
    `${base}/api/endpoints/${endpointId}/docker/containers/${id}/${action}`,
    { method: "POST", headers: { "X-API-Key": cfg.apiKey } }
  );
  if (res.status !== 304) throwForStatus(res, KEY_ERRORS);
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
// 8-byte header [stream(1), 0, 0, 0, size(4, big-endian)]. This walks the
// frames as the body streams in — a frame, or its header, can straddle two
// chunks — and keeps the last `windowBytes` of their payloads in a ring
// buffer, so what is held is the window plus the chunk in hand whatever the
// body's size (#427). The window applies to the demuxed text, never to the
// raw bytes: cutting those would land mid-frame, and a misaligned header
// would bail to raw with stray header bytes at line starts (#218). A TTY
// container streams raw text with no frames, so a header that isn't a valid
// frame (stream byte > 2 or the reserved bytes non-zero) means the rest is
// raw and goes into the window verbatim. Exported for testing.
export class DockerLogTail {
  private readonly ring: Buffer;
  // Next write offset into the ring, and how much of the ring holds text.
  private pos = 0;
  private filled = 0;
  // Whether text has fallen out of the window (the start may then be
  // mid-character).
  private dropped = false;
  private raw = false;
  // The header of the frame being started, as much of it as has arrived.
  private readonly header = Buffer.alloc(8);
  private headerLen = 0;
  // Payload bytes still to come for the current frame.
  private remaining = 0;

  constructor(private readonly windowBytes: number = PORTAINER_LOG_MAX_BYTES) {
    this.ring = Buffer.allocUnsafe(windowBytes);
  }

  push(chunk: Uint8Array): void {
    let i = 0;
    while (i < chunk.length) {
      if (this.raw) {
        this.keep(chunk.subarray(i));
        return;
      }
      if (this.remaining > 0) {
        const n = Math.min(this.remaining, chunk.length - i);
        this.keep(chunk.subarray(i, i + n));
        i += n;
        this.remaining -= n;
        continue;
      }
      // At a frame boundary: gather the header, which may arrive in pieces.
      const take = Math.min(8 - this.headerLen, chunk.length - i);
      this.header.set(chunk.subarray(i, i + take), this.headerLen);
      this.headerLen += take;
      i += take;
      if (this.headerLen < 8) return;
      this.headerLen = 0;
      const h = this.header;
      if (h[0] > 2 || h[1] !== 0 || h[2] !== 0 || h[3] !== 0) {
        // Not framed (a TTY container, or unexpected data) — the rest is raw,
        // these eight bytes included.
        this.raw = true;
        this.keep(h);
        continue;
      }
      this.remaining = h.readUInt32BE(4);
    }
  }

  // The window's text, once the body has ended. A header cut short by the
  // end is raw tail and kept; a frame cut short just ends early.
  text(): string {
    if (this.headerLen > 0) {
      this.keep(this.header.subarray(0, this.headerLen));
      this.headerLen = 0;
    }
    let out =
      this.filled < this.windowBytes
        ? this.ring.subarray(0, this.filled)
        : Buffer.concat([this.ring.subarray(this.pos), this.ring.subarray(0, this.pos)]);
    // Dropping text can cut a multi-byte character; skip what's left of it
    // (its continuation bytes) so the text starts whole, not with U+FFFD.
    if (this.dropped) {
      let skip = 0;
      while (skip < out.length && skip < 3 && (out[skip] & 0xc0) === 0x80) skip++;
      out = out.subarray(skip);
    }
    return out.toString("utf8");
  }

  // Append text to the ring, letting the oldest fall out past the window.
  private keep(p: Uint8Array): void {
    const w = this.windowBytes;
    if (p.length >= w) {
      this.ring.set(p.subarray(p.length - w));
      if (this.filled > 0 || p.length > w) this.dropped = true;
      this.pos = 0;
      this.filled = w;
      return;
    }
    const first = Math.min(p.length, w - this.pos);
    this.ring.set(p.subarray(0, first), this.pos);
    if (first < p.length) this.ring.set(p.subarray(first), 0);
    this.pos = (this.pos + p.length) % w;
    if (this.filled + p.length > w) this.dropped = true;
    this.filled = Math.min(w, this.filled + p.length);
  }
}

// A read-only tail of one container's logs. Reads raw bytes (not the utf8 text
// serviceRequest yields) so the multiplexed frame headers survive to be
// demuxed, under the same timeout as every service read (serviceFetch's
// signal covers the body), and bounded as PORTAINER_LOG_READ_MAX_BYTES
// describes. No exec, no console — logs only. The id is encoded for the same
// reason as containerCommand's (#379).
export async function containerLogs(
  cfg: PortainerConfig,
  endpointId: number,
  containerId: string
): Promise<string> {
  const base = serviceBase(cfg.url);
  const id = encodeURIComponent(containerId);
  const url =
    `${base}/api/endpoints/${endpointId}/docker/containers/${id}` +
    `/logs?stdout=1&stderr=1&timestamps=0&tail=${PORTAINER_LOG_TAIL}`;
  try {
    const res = await serviceFetch(url, { headers: { "X-API-Key": cfg.apiKey } });
    throwForStatus(res, KEY_ERRORS);
    // Demux the body as it streams, keeping the last PORTAINER_LOG_MAX_BYTES
    // of text (#427). Under #402 the whole body was read first, under the
    // service body cap, so a tail past 4 MB was refused outright where it
    // used to show its end; now only the window is ever held.
    const tail = new DockerLogTail(PORTAINER_LOG_MAX_BYTES);
    const complete = await streamCapped(
      res,
      PORTAINER_LOG_READ_MAX_BYTES,
      (chunk) => tail.push(chunk),
      { trustContentLength: false }
    );
    if (!complete) throw new ServiceError("Response too large");
    return tail.text();
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    log.warn("portainer logs fetch error", {
      host: hostOf(base),
      reason: errorReason(e),
    });
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new ServiceError(aborted ? "Timed out" : "Couldn't connect");
  }
}
