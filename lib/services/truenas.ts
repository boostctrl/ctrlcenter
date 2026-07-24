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
  ServiceError,
  serviceBase,
  serviceJson,
  runProbe,
  type ProbeResult,
} from "./http";
import { resolveSecret } from "../secrets";

export type TruenasConfig = { url: string; apiKey: string };

// The API key can come from the environment instead of config.yaml, same
// convention as the other integrations.
export function resolveTruenasApiKey(cfg: { apiKey: string }): string {
  return resolveSecret("CTRLCENTER_TRUENAS_KEY", cfg.apiKey);
}

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
export const TRUENAS_APP_CAP = 8;
export const TRUENAS_ALERT_CAP = 6;

// --- Raw API shapes (only the fields the snapshot uses) ---

type RawPool = {
  name?: string;
  status?: string;
  healthy?: boolean;
  size?: number | string | null;
  allocated?: number | string | null;
  free?: number | string | null;
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

async function truenasJson<T>(cfg: TruenasConfig, path: string): Promise<T> {
  const base = serviceBase(cfg.url);
  try {
    return await serviceJson<T>(`${base}${path}`, {
      headers: { Authorization: `Bearer ${resolveTruenasApiKey(cfg)}` },
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

export async function getTruenasSnapshot(
  cfg: TruenasConfig
): Promise<TruenasSnapshot> {
  const [poolsR, appsR, alertsR] = await Promise.allSettled([
    truenasJson<RawPool[]>(cfg, "/api/v2.0/pool"),
    truenasJson<RawApp[]>(cfg, "/api/v2.0/app"),
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
