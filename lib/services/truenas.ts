// Typed client for the TrueNAS SCALE middleware REST API (#193). Server-side
// only — calls happen inside admin-gated routes via the monitor cache, and
// the API key never reaches the browser. TrueNAS authenticates with an API
// key as a Bearer token.
//
// The card answers "is my storage healthy": per-pool status and capacity, and
// the active (non-dismissed) alerts, which already cover SMART failures,
// replication problems, and the like. Strictly read-only by design — TrueNAS
// write actions are permanently out of scope for the dashboard.

import {
  serviceBase,
  serviceRequest,
  parseJson,
  throwForStatus,
  runProbe,
  type ProbeResult,
} from "./http";
import { isPlainHttp } from "../urls";

export type TruenasConfig = { url: string; apiKey: string };

export type TruenasPool = {
  name: string;
  // ONLINE / DEGRADED / FAULTED / OFFLINE / … reported verbatim.
  status: string;
  healthy: boolean;
  // Fraction of capacity used, 0..1; null when TrueNAS didn't report sizes.
  usedRatio: number | null;
  // Bytes free; null when unknown.
  free: number | null;
};

export type TruenasAlert = { level: "warning" | "critical"; message: string };

// One container (workload) an app runs, from active_workloads.container_details:
// its service/name, verbatim state ("running" / "exited" / …), and image.
export type TruenasContainer = {
  name: string;
  state: string;
  image: string | null;
};

// One installed app from the Docker-based Apps system (SCALE 24.10+). `state`
// is TrueNAS's verbatim RUNNING / STOPPED / DEPLOYING / CRASHED; `running` is
// the derived healthy read. `containers` is how many workloads the app runs
// (null when TrueNAS didn't report it); `containerList` is those workloads when
// TrueNAS details them (the detail page lists them). `upgradeAvailable` flags a
// pending update.
export type TruenasApp = {
  name: string;
  state: string;
  running: boolean;
  upgradeAvailable: boolean;
  containers: number | null;
  containerList: TruenasContainer[];
};

export type TruenasSnapshot = {
  pools: TruenasPool[];
  apps: TruenasApp[];
  alerts: TruenasAlert[];
};

export const TRUENAS_POOL_CAP = 8;
// The detail page lists every app, so the cap is generous — high enough that a
// typical homelab's full app roster shows, still bounded against a runaway list.
export const TRUENAS_APP_CAP = 60;
export const TRUENAS_ALERT_CAP = 6;

// Each TrueNAS app object is large (it carries the app's full config and catalog
// metadata), so a host with dozens of apps returns a body far past the default
// service cap — which would fail the whole fetch as "Response too large" and
// show no apps at all. Give the app query a generous budget so the full roster
// comes back.
export const TRUENAS_MAX_BYTES = 24 * 1024 * 1024;

// --- Raw API shapes (only the fields the snapshot uses) ---

type RawPool = {
  name?: string;
  status?: string;
  healthy?: boolean;
  size?: number | string | null;
  allocated?: number | string | null;
  free?: number | string | null;
  // The last scrub or resilver, and the vdev tree the disks hang from.
  scan?: {
    function?: string;
    state?: string;
    end_time?: { $date?: number } | number | null;
    errors?: number;
  } | null;
  topology?: Record<string, unknown>;
};
type RawAlert = {
  level?: string;
  formatted?: string | null;
  text?: string | null;
  dismissed?: boolean;
};
type RawContainer = {
  id?: string;
  service_name?: string;
  image?: string;
  state?: string;
};
type RawApp = {
  name?: string;
  state?: string;
  upgrade_available?: boolean;
  active_workloads?: {
    containers?: number;
    container_details?: RawContainer[];
  } | null;
};

// Some apps run many workloads; the detail page lists them, but cap so a
// pathological compose file can't blow up the payload.
const TRUENAS_CONTAINER_CAP = 20;

function mapContainers(raw: RawContainer[] | undefined): TruenasContainer[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, TRUENAS_CONTAINER_CAP).map((c, i) => ({
    name: c.service_name?.trim() || c.id?.trim() || `container ${i + 1}`,
    state: typeof c.state === "string" && c.state ? c.state.toLowerCase() : "unknown",
    image: typeof c.image === "string" && c.image ? c.image : null,
  }));
}

// TrueNAS reports some byte counts as strings (they exceed 2^53); read them
// leniently and treat anything unparseable as unknown.
const bytes = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

// Alert levels above INFO/NOTICE map to two card tones; INFO/NOTICE and
// dismissed alerts are dropped. Everything at ERROR and above is "critical".
const CRITICAL_LEVELS = new Set(["ERROR", "CRITICAL", "ALERT", "EMERGENCY"]);

export function mapTruenasPools(raw: unknown): TruenasPool[] {
  const list = Array.isArray(raw) ? (raw as RawPool[]) : [];
  return list.slice(0, TRUENAS_POOL_CAP).map((p, i) => {
    const size = bytes(p.size);
    const allocated = bytes(p.allocated);
    const free = bytes(p.free);
    const usedRatio =
      size !== null && size > 0 && allocated !== null
        ? Math.min(1, Math.max(0, allocated / size))
        : null;
    return {
      name: p.name?.trim() || `Pool ${i + 1}`,
      status: typeof p.status === "string" && p.status ? p.status : "UNKNOWN",
      // A pool is healthy only when TrueNAS says so AND its status is ONLINE.
      healthy: p.healthy === true && (p.status ?? "ONLINE") === "ONLINE",
      usedRatio,
      free,
    };
  });
}

export function mapTruenasAlerts(raw: unknown): TruenasAlert[] {
  const list = Array.isArray(raw) ? (raw as RawAlert[]) : [];
  const out: TruenasAlert[] = [];
  for (const a of list) {
    if (a.dismissed === true) continue;
    const level = typeof a.level === "string" ? a.level.toUpperCase() : "";
    if (level === "" || level === "INFO" || level === "NOTICE") continue;
    const message = (a.formatted ?? a.text ?? "").trim();
    if (message === "") continue;
    out.push({
      level: CRITICAL_LEVELS.has(level) ? "critical" : "warning",
      message,
    });
    if (out.length >= TRUENAS_ALERT_CAP) break;
  }
  return out;
}

// Apps the admin runs on TrueNAS's Docker engine (SCALE 24.10+). Not-running
// apps sort first so a crashed/stopped app surfaces at the top of the list, the
// same "problems first" treatment the alerts get.
export function mapTruenasApps(raw: unknown): TruenasApp[] {
  const list = Array.isArray(raw) ? (raw as RawApp[]) : [];
  const apps = list.map((a, i) => {
    const state =
      typeof a.state === "string" && a.state ? a.state.toUpperCase() : "UNKNOWN";
    const w = a.active_workloads;
    const containerList = mapContainers(w?.container_details);
    const containers =
      typeof w?.containers === "number"
        ? w.containers
        : containerList.length > 0
          ? containerList.length
          : null;
    return {
      name: a.name?.trim() || `App ${i + 1}`,
      state,
      running: state === "RUNNING",
      upgradeAvailable: a.upgrade_available === true,
      containers,
      containerList,
    };
  });
  apps.sort((a, b) => Number(a.running) - Number(b.running));
  return apps.slice(0, TRUENAS_APP_CAP);
}

async function truenasJson<T>(
  cfg: TruenasConfig,
  path: string,
  maxBytes?: number
): Promise<T> {
  return truenasCall<T>(cfg, path, {}, maxBytes);
}

// TrueNAS 25.04 and later revoke an API key the first time it arrives over
// plain http (#560), and then answer like any wrong key: over http, a
// refused key says it may be that.
export const REVOKED_OVER_HTTP =
  "Invalid API key. TrueNAS 25.04 and later revoke a key sent over plain http: reset it in TrueNAS and use the https address.";

async function truenasCall<T>(
  cfg: TruenasConfig,
  path: string,
  init: RequestInit = {},
  maxBytes?: number
): Promise<T> {
  const base = serviceBase(cfg.url);
  const { res, text } = await serviceRequest(
    `${base}${path}`,
    { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${cfg.apiKey}` } },
    maxBytes
  );
  const refused = isPlainHttp(base) ? REVOKED_OVER_HTTP : "Invalid API key";
  throwForStatus(res, { 401: refused, 403: refused });
  return parseJson<T>(text);
}

export async function getTruenasSnapshot(
  cfg: TruenasConfig
): Promise<TruenasSnapshot> {
  const [poolsR, appsR, alertsR] = await Promise.allSettled([
    truenasJson<RawPool[]>(cfg, "/api/v2.0/pool"),
    // An explicit limit (in case the endpoint imposes a smaller default page)
    // plus a raised byte budget, so the whole app roster comes back.
    truenasJson<RawApp[]>(
      cfg,
      `/api/v2.0/app?limit=${TRUENAS_APP_CAP}`,
      TRUENAS_MAX_BYTES
    ),
    truenasJson<RawAlert[]>(cfg, "/api/v2.0/alert/list"),
  ]);
  // Pools failing means the key or host is wrong — surface it. A failed apps or
  // alert list alone (an older SCALE without /app, or a key-scope quirk)
  // shouldn't blank the pools; those sections just come back empty.
  if (poolsR.status === "rejected") throw poolsR.reason;
  return {
    pools: mapTruenasPools(poolsR.value),
    apps: appsR.status === "fulfilled" ? mapTruenasApps(appsR.value) : [],
    alerts: alertsR.status === "fulfilled" ? mapTruenasAlerts(alertsR.value) : [],
  };
}

// --- The detail page's extras (#528): the system, each disk with its
// temperature and pool, and each pool's size and last scrub. ---

export type TruenasSystem = {
  version: string;
  hostname: string;
  model: string;
  uptimeSeconds: number | null;
  cores: number | null;
  // Bytes of memory.
  memory: number | null;
  // The 1, 5 and 15 minute load averages.
  load: [number, number, number] | null;
};
export type TruenasDisk = {
  name: string;
  model: string;
  size: number | null;
  kind: "HDD" | "SSD" | "";
  pool: string | null;
  // Degrees Celsius, when TrueNAS reported one.
  temperature: number | null;
};
export type TruenasPoolDetail = {
  name: string;
  size: number | null;
  used: number | null;
  // The last scrub or resilver: what ran, how it ended, when and the
  // errors it found; null when the pool hasn't had one.
  scan: { kind: string; state: string; at: number | null; errors: number } | null;
};
export type TruenasDetail = TruenasSnapshot & {
  system: TruenasSystem | null;
  disks: TruenasDisk[];
  poolDetail: TruenasPoolDetail[];
};
export const TRUENAS_DISK_CAP = 48;

type RawSystem = {
  version?: string;
  hostname?: string;
  model?: string;
  uptime_seconds?: number;
  cores?: number;
  physmem?: number;
  loadavg?: unknown;
};
type RawDisk = { name?: string; model?: string; size?: number | string; type?: string; pool?: string | null };

const text = (v: unknown, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export function mapTruenasSystem(raw: unknown): TruenasSystem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawSystem;
  const load = Array.isArray(r.loadavg) && r.loadavg.length >= 3 && r.loadavg.slice(0, 3).every((n) => typeof n === "number")
    ? (r.loadavg.slice(0, 3) as [number, number, number])
    : null;
  return {
    version: text(r.version),
    hostname: text(r.hostname),
    model: text(r.model),
    uptimeSeconds: positive(r.uptime_seconds),
    cores: positive(r.cores),
    memory: positive(r.physmem),
    load,
  };
}

// The disk names under a pool's vdev tree: each leaf carries its device.
function poolDisks(topology: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const n = node as { disk?: unknown; children?: unknown };
    if (typeof n.disk === "string" && n.disk) out.push(n.disk);
    if (n.children) walk(n.children);
  };
  if (topology && typeof topology === "object") Object.values(topology).forEach(walk);
  return out;
}

// The scan's end, which TrueNAS gives as { $date: ms } or epoch seconds.
function scanTime(v: unknown): number | null {
  if (v && typeof v === "object" && typeof (v as { $date?: unknown }).$date === "number") return (v as { $date: number }).$date;
  if (typeof v === "number" && v > 0) return v < 1e12 ? v * 1000 : v;
  return null;
}

export function mapTruenasPoolDetail(raw: unknown): TruenasPoolDetail[] {
  const list = Array.isArray(raw) ? (raw as RawPool[]) : [];
  return list.slice(0, TRUENAS_POOL_CAP).map((p, i) => {
    const scan = p.scan && typeof p.scan === "object" && p.scan.function ? p.scan : null;
    return {
      name: p.name?.trim() || `Pool ${i + 1}`,
      size: bytes(p.size),
      used: bytes(p.allocated),
      scan: scan
        ? {
            kind: text(scan.function).toLowerCase(),
            state: text(scan.state).toLowerCase(),
            at: scanTime(scan.end_time),
            errors: typeof scan.errors === "number" && scan.errors > 0 ? scan.errors : 0,
          }
        : null,
    };
  });
}

// The disks, each with its pool (from the pools' vdev trees, else the
// disk's own field) and its temperature, hottest first.
export function mapTruenasDisks(raw: unknown, pools: unknown, temperatures: unknown): TruenasDisk[] {
  const owner = new Map<string, string>();
  for (const p of Array.isArray(pools) ? (pools as RawPool[]) : []) {
    for (const d of poolDisks(p.topology)) if (p.name) owner.set(d, p.name);
  }
  const temps = temperatures && typeof temperatures === "object" ? (temperatures as Record<string, unknown>) : {};
  return (Array.isArray(raw) ? (raw as RawDisk[]) : [])
    .filter((d) => typeof d?.name === "string" && d.name !== "")
    .slice(0, TRUENAS_DISK_CAP)
    .map((d): TruenasDisk => {
      const name = d.name as string;
      const t = temps[name];
      const kind = text(d.type).toUpperCase();
      return {
        name,
        model: text(d.model),
        size: bytes(d.size),
        kind: kind === "HDD" || kind === "SSD" ? kind : "",
        pool: owner.get(name) ?? (text(d.pool) || null),
        temperature: typeof t === "number" && Number.isFinite(t) && t > 0 && t < 120 ? Math.round(t) : null,
      };
    })
    .sort((a, b) => (b.temperature ?? -1) - (a.temperature ?? -1) || a.name.localeCompare(b.name));
}

// The detail read: the snapshot, plus the system, disks and each pool's
// scan, each best effort, so one TrueNAS won't answer leaves its part empty.
export async function getTruenasDetail(cfg: TruenasConfig): Promise<TruenasDetail> {
  const quiet = <T,>(path: string, init?: RequestInit) =>
    truenasCall<T>(cfg, path, init).catch(() => null);
  const [snapshot, system, pools, disks, temperatures] = await Promise.all([
    getTruenasSnapshot(cfg),
    quiet<unknown>("/api/v2.0/system/info"),
    quiet<unknown>("/api/v2.0/pool"),
    quiet<unknown>(`/api/v2.0/disk?limit=${TRUENAS_DISK_CAP}`),
    quiet<unknown>("/api/v2.0/disk/temperatures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: [] }),
    }),
  ]);
  return {
    ...snapshot,
    system: mapTruenasSystem(system),
    disks: mapTruenasDisks(disks, pools, temperatures),
    poolDetail: mapTruenasPoolDetail(pools),
  };
}

// Fresh reachability check for the admin's "Test connection" button. The
// system/info endpoint needs the key and names the version, so success proves
// both the key and that TrueNAS is on the other end.
export async function probeTruenas(cfg: TruenasConfig): Promise<ProbeResult> {
  return runProbe("truenas", async () => {
    const info = await truenasJson<{ version?: string }>(
      cfg,
      "/api/v2.0/system/info"
    );
    const version =
      typeof info.version === "string" && info.version !== ""
        ? ` ${info.version}`
        : "";
    return `TrueNAS${version}`;
  });
}
