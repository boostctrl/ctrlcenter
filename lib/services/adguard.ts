// Typed client for the AdGuard Home API (#192). Server-side only — calls
// happen inside admin-gated routes via the monitor cache, and the credentials
// never reach the browser. AdGuard Home authenticates every /control request
// with HTTP Basic auth (the same account as its web UI); an install with no
// account set up answers without auth, so an empty username sends none.
//
// The card answers "is my DNS filtering working, and how hard": protection
// on/off, query volume and blocked share over the stats window, and the most
// blocked domains.

import {
  ServiceError,
  serviceBase,
  serviceJson,
  runProbe,
  type ProbeResult,
} from "./http";
import { resolveSecret } from "../secrets";

export type AdguardConfig = {
  url: string;
  username: string;
  password: string;
};

// The password can come from the environment instead of config.yaml, same
// convention as the other integrations.
export function resolveAdguardPassword(cfg: { password: string }): string {
  return resolveSecret("CTRLCENTER_ADGUARD_PASS", cfg.password);
}

export type AdguardSnapshot = {
  protectionEnabled: boolean;
  // Totals over the stats window AdGuard is configured with (24h by default).
  totalQueries: number;
  blocked: number;
  // blocked / total, 0..1; 0 when there were no queries.
  blockedRatio: number;
  // Average lookup processing time in ms; null when the stats omit it.
  avgProcessingMs: number | null;
  // "last 24 hours" / "last 7 days" — the stats window, when derivable.
  windowLabel: string | null;
  topBlocked: { domain: string; count: number }[];
};

export const ADGUARD_TOP_BLOCKED_CAP = 5;

// --- Raw API shapes (only the fields the snapshot uses) ---

type RawStatus = { version?: string; protection_enabled?: boolean };
type RawStats = {
  time_units?: string;
  num_dns_queries?: number;
  num_blocked_filtering?: number;
  avg_processing_time?: number;
  // Per-unit series; only its length is used (to size the window label).
  dns_queries?: unknown[];
  // AdGuard's shape: one { "domain.tld": count } object per entry.
  top_blocked_domains?: Record<string, unknown>[];
};

const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;

// Exported for the unit tests: fold the two raw payloads into the snapshot.
export function mapAdguardSnapshot(
  statusRaw: unknown,
  statsRaw: unknown
): AdguardSnapshot {
  const status = (statusRaw ?? {}) as RawStatus;
  const stats = (statsRaw ?? {}) as RawStats;

  const totalQueries = count(stats.num_dns_queries);
  const blocked = count(stats.num_blocked_filtering);

  // avg_processing_time is reported in seconds (fractions of one).
  const avgMs =
    typeof stats.avg_processing_time === "number" &&
    Number.isFinite(stats.avg_processing_time) &&
    stats.avg_processing_time > 0
      ? stats.avg_processing_time * 1000
      : null;

  const units = Array.isArray(stats.dns_queries) ? stats.dns_queries.length : 0;
  const windowLabel =
    stats.time_units === "hours" && units > 0
      ? "last 24 hours"
      : stats.time_units === "days" && units > 0
        ? `last ${units} day${units === 1 ? "" : "s"}`
        : null;

  const topBlocked: { domain: string; count: number }[] = [];
  for (const entry of stats.top_blocked_domains ?? []) {
    if (typeof entry !== "object" || entry === null) continue;
    const [domain, hits] = Object.entries(entry)[0] ?? [];
    if (typeof domain !== "string" || domain === "") continue;
    topBlocked.push({ domain, count: count(hits) });
    if (topBlocked.length >= ADGUARD_TOP_BLOCKED_CAP) break;
  }

  return {
    protectionEnabled: status.protection_enabled === true,
    totalQueries,
    blocked,
    blockedRatio: totalQueries > 0 ? blocked / totalQueries : 0,
    avgProcessingMs: avgMs,
    windowLabel,
    topBlocked,
  };
}

function adguardHeaders(cfg: AdguardConfig): Record<string, string> {
  const user = cfg.username.trim();
  // No account configured — an open AdGuard Home install answers without auth.
  if (user === "") return {};
  const pass = resolveAdguardPassword(cfg);
  return {
    Authorization:
      "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"),
  };
}

async function adguardJson<T>(cfg: AdguardConfig, path: string): Promise<T> {
  const base = serviceBase(cfg.url);
  try {
    return await serviceJson<T>(`${base}${path}`, {
      headers: adguardHeaders(cfg),
    });
  } catch (e) {
    // AdGuard answers 403 to bad or missing credentials; say it plainly.
    if (
      e instanceof ServiceError &&
      (e.message === "HTTP 403" || e.message === "HTTP 401")
    ) {
      throw new ServiceError("Login failed — check the username and password");
    }
    throw e;
  }
}

export async function getAdguardSnapshot(
  cfg: AdguardConfig
): Promise<AdguardSnapshot> {
  const [status, stats] = await Promise.all([
    adguardJson<RawStatus>(cfg, "/control/status"),
    adguardJson<RawStats>(cfg, "/control/stats"),
  ]);
  return mapAdguardSnapshot(status, stats);
}

// Fresh reachability check for the admin's "Test connection" button. The
// status endpoint needs the credentials and names the version, and its shape
// distinguishes AdGuard Home from some other JSON-speaking service.
export async function probeAdguard(cfg: AdguardConfig): Promise<ProbeResult> {
  return runProbe("adguard", async () => {
    const status = await adguardJson<RawStatus>(cfg, "/control/status");
    if (
      typeof status?.version !== "string" &&
      typeof status?.protection_enabled !== "boolean"
    ) {
      throw new ServiceError("Is the URL an AdGuard Home instance?");
    }
    const version =
      typeof status.version === "string" && status.version !== ""
        ? ` ${status.version}`
        : "";
    return `AdGuard Home${version}`;
  });
}
