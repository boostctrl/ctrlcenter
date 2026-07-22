// Typed client for the UniFi Network controller API (#194). Server-side only —
// calls happen inside admin-gated routes via the monitor cache, and the
// credentials never reach the browser. UniFi uses a local account with
// session-cookie auth: the client logs in, caches the session cookie per
// connection on globalThis (lib module state forks per route bundle), and
// re-logs-in once on a 401 so an expired session heals without an error.
//
// Two controller variants, auto-detected at login:
//   - UniFi OS (UDM/UDR/Cloud Key Gen2+): POST /api/auth/login, data proxied
//     under /proxy/network.
//   - Classic self-hosted controller: POST /api/login, data at the root.
// Every read here is a GET, so the UniFi OS CSRF token (required only for
// mutating methods) is not needed.
//
// A self-hosted controller is HTTPS-only with a self-signed certificate by
// default and no plaintext alternative, so this client honors the
// integration's opt-in `allowInsecureTls` flag (via insecureHttpsRequest).
//
// The card answers "is the internet up, how many clients are on, and is any
// UniFi gear offline". Recent-alarm endpoints moved/were removed across
// controller versions, so "issues" are derived from the always-present health
// subsystems (a degraded subsystem, or a disconnected/pending device) rather
// than from a fragile alarm endpoint.

import {
  ServiceError,
  serviceBase,
  serviceRequest,
  insecureHttpsRequest,
  parseJson,
  runProbe,
  type ProbeResult,
} from "./http";
import { resolveSecret } from "../secrets";

export type UnifiConfig = {
  url: string;
  username: string;
  password: string;
  allowInsecureTls: boolean;
};

// The password can come from the environment instead of config.yaml, same
// convention as the other integrations.
export function resolveUnifiPassword(cfg: { password: string }): string {
  return resolveSecret("CTRLCENTER_UNIFI_PASS", cfg.password);
}

export type UnifiSnapshot = {
  internet: {
    // The WAN uplink and internet-health subsystems both reading ok.
    up: boolean;
    isp: string | null;
    wanIp: string | null;
    // Internet latency in ms (the `www` subsystem), when reported.
    latencyMs: number | null;
  };
  clients: { total: number; wireless: number; wired: number; guests: number };
  devices: { adopted: number; disconnected: number; pending: number };
  // Derived health issues, most severe first, capped for the card.
  issues: { level: "warning" | "error"; message: string }[];
};

export const UNIFI_ISSUE_CAP = 6;
const DEFAULT_SITE = "default";

// --- Raw API shapes (only the fields the snapshot uses) ---

type RawEnvelope<T> = { data?: T; meta?: { rc?: string; msg?: string } };
type RawSubsystem = {
  subsystem?: string;
  status?: string;
  num_user?: number;
  num_guest?: number;
  num_iot?: number;
  num_adopted?: number;
  num_disconnected?: number;
  num_pending?: number;
  wan_ip?: string;
  isp_name?: string;
  latency?: number;
};

const int = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;

const SUBSYSTEM_LABELS: Record<string, string> = {
  wan: "WAN",
  www: "Internet",
  wlan: "WiFi",
  lan: "LAN",
  vpn: "VPN",
};

// Exported for the unit tests: fold the health subsystems into the snapshot.
export function mapUnifiHealth(raw: unknown): UnifiSnapshot {
  const subsystems = Array.isArray(raw) ? (raw as RawSubsystem[]) : [];
  const by = (name: string) => subsystems.find((s) => s.subsystem === name) ?? {};
  const wan = by("wan");
  const www = by("www");
  const wlan = by("wlan");
  const lan = by("lan");

  const wireless = int(wlan.num_user) + int(wlan.num_guest);
  const wired = int(lan.num_user) + int(lan.num_guest);
  const guests = int(wlan.num_guest) + int(lan.num_guest);

  // UniFi gear lives on the wan (gateway), wlan (APs), and lan (switches)
  // subsystems; sum their device tallies for the "is anything offline" line.
  const infra = [wan, wlan, lan];
  const devices = {
    adopted: infra.reduce((n, s) => n + int(s.num_adopted), 0),
    disconnected: infra.reduce((n, s) => n + int(s.num_disconnected), 0),
    pending: infra.reduce((n, s) => n + int(s.num_pending), 0),
  };

  const issues: UnifiSnapshot["issues"] = [];
  // A subsystem reporting anything other than "ok" is the headline problem.
  for (const s of subsystems) {
    if (!s.status || s.status === "ok") continue;
    const label = SUBSYSTEM_LABELS[s.subsystem ?? ""] ?? s.subsystem ?? "System";
    issues.push({
      level: s.status === "error" ? "error" : "warning",
      message: `${label} ${s.status === "error" ? "down" : "degraded"}`,
    });
  }
  if (devices.disconnected > 0) {
    issues.push({
      level: "error",
      message: `${devices.disconnected} device${
        devices.disconnected === 1 ? "" : "s"
      } disconnected`,
    });
  }
  if (devices.pending > 0) {
    issues.push({
      level: "warning",
      message: `${devices.pending} device${
        devices.pending === 1 ? "" : "s"
      } pending adoption`,
    });
  }
  // Errors ahead of warnings, then in discovery order.
  issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));

  return {
    internet: {
      up: (wan.status ?? "") === "ok" && (www.status ?? "ok") === "ok",
      isp: wan.isp_name?.trim() || null,
      wanIp: wan.wan_ip?.trim() || null,
      latencyMs: typeof www.latency === "number" ? www.latency : null,
    },
    clients: { total: wireless + wired, wireless, wired, guests },
    devices,
    issues: issues.slice(0, UNIFI_ISSUE_CAP),
  };
}

// --- Session cache (keyed by connection, mirrors qBittorrent's) ---

type Session = { cookie: string; prefix: string };

const g = globalThis as unknown as {
  __ctrlcenterUnifiSessions?: Map<string, Session>;
  __ctrlcenterUnifiLogins?: Map<string, Promise<Session>>;
};
const sessions = (g.__ctrlcenterUnifiSessions ??= new Map());
const loginsInFlight = (g.__ctrlcenterUnifiLogins ??= new Map());

const sessionKey = (base: string, username: string) => `${base}|${username}`;

// Whether to route this connection through the cert-skipping path: only when
// the admin opted in AND the URL is https (http has nothing to skip).
const usesInsecure = (base: string, cfg: UnifiConfig) =>
  cfg.allowInsecureTls && base.startsWith("https:");

// One request, over fetch (verifying) or the self-signed path, normalized to
// the fields the client needs.
async function rawRequest(
  base: string,
  cfg: UnifiConfig,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; ok: boolean; setCookie: string[]; text: string }> {
  const url = `${base}${path}`;
  if (usesInsecure(base, cfg)) return insecureHttpsRequest(url, init);
  const { res, text } = await serviceRequest(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
  });
  const setCookie =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : ((c) => (c ? [c] : []))(res.headers.get("set-cookie"));
  return { status: res.status, ok: res.ok, setCookie, text };
}

// Replay every cookie the login set (UniFi OS → TOKEN, classic → unifises +
// csrf_token) as one Cookie header.
const cookieHeader = (setCookie: string[]) =>
  setCookie.map((c) => c.split(";")[0]).filter(Boolean).join("; ");

function login(base: string, cfg: UnifiConfig): Promise<Session> {
  const key = sessionKey(base, cfg.username);
  const running = loginsInFlight.get(key);
  if (running) return running;
  const run = mintSession(base, cfg).finally(() => loginsInFlight.delete(key));
  loginsInFlight.set(key, run);
  return run;
}

async function mintSession(base: string, cfg: UnifiConfig): Promise<Session> {
  const body = JSON.stringify({
    username: cfg.username,
    password: resolveUnifiPassword(cfg),
    rememberMe: false,
  });
  const attempt = (path: string) =>
    rawRequest(base, cfg, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

  // UniFi OS first; its /api/auth/login 404s on a classic controller, which is
  // the signal to fall back to the classic /api/login.
  const os = await attempt("/api/auth/login");
  let result = os;
  let prefix = "/proxy/network";
  if (os.status === 404) {
    result = await attempt("/api/login");
    prefix = "";
  }
  if (result.status === 400 || result.status === 401) {
    throw new ServiceError("Login failed — check the username and password");
  }
  if (result.status === 404) {
    throw new ServiceError("Is the URL a UniFi controller?");
  }
  if (!result.ok) throw new ServiceError(`HTTP ${result.status}`);
  const cookie = cookieHeader(result.setCookie);
  if (!cookie) {
    throw new ServiceError("Login succeeded but no session cookie came back");
  }
  const session = { cookie, prefix };
  sessions.set(sessionKey(base, cfg.username), session);
  return session;
}

// GET a controller endpoint, logging in on a missing/expired session. Exactly
// one retry: a 401 straight after a fresh login is a real error.
async function unifiGet(
  base: string,
  cfg: UnifiConfig,
  path: (prefix: string) => string
): Promise<string> {
  const key = sessionKey(base, cfg.username);
  let session = sessions.get(key) ?? (await login(base, cfg));
  let res = await rawRequest(base, cfg, path(session.prefix), {
    headers: { Cookie: session.cookie },
  });
  if (res.status === 401) {
    sessions.delete(key);
    session = await login(base, cfg);
    res = await rawRequest(base, cfg, path(session.prefix), {
      headers: { Cookie: session.cookie },
    });
  }
  if (!res.ok) throw new ServiceError(`HTTP ${res.status}`);
  return res.text;
}

function siteData<T>(text: string): T {
  const env = parseJson<RawEnvelope<T>>(text);
  return (env.data ?? []) as T;
}

export async function getUnifiSnapshot(cfg: UnifiConfig): Promise<UnifiSnapshot> {
  const base = serviceBase(cfg.url);
  const text = await unifiGet(
    base,
    cfg,
    (prefix) => `${prefix}/api/s/${DEFAULT_SITE}/stat/health`
  );
  return mapUnifiHealth(siteData<RawSubsystem[]>(text));
}

// Fresh reachability check for the admin's "Test connection" button: a real
// login plus the controller's sysinfo, so success proves the credentials and
// names the UniFi Network version on the other end.
export async function probeUnifi(cfg: UnifiConfig): Promise<ProbeResult> {
  return runProbe("unifi", async () => {
    const base = serviceBase(cfg.url);
    // Probe with fresh state — not a cached session (mirrors qBittorrent).
    const key = sessionKey(base, cfg.username);
    sessions.delete(key);
    loginsInFlight.delete(key);
    const text = await unifiGet(
      base,
      cfg,
      (prefix) => `${prefix}/api/s/${DEFAULT_SITE}/stat/sysinfo`
    );
    const info = siteData<{ version?: string }[]>(text);
    const version =
      Array.isArray(info) && typeof info[0]?.version === "string"
        ? ` ${info[0].version}`
        : "";
    return `UniFi Network${version}`.trim();
  });
}
