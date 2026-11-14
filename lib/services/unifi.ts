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
  throwForStatus,
  runProbe,
  type ProbeResult,
} from "./http";
import { globalSingleton } from "../singleton";

export type UnifiConfig = {
  url: string;
  username: string;
  password: string;
  allowInsecureTls: boolean;
};

export type UnifiSnapshot = {
  internet: {
    // The WAN uplink and internet-health subsystems both reading ok.
    up: boolean;
    isp: string | null;
    wanIp: string | null;
    // Internet latency in ms (the `www` subsystem), when reported.
    latencyMs: number | null;
  };
  // Counted from the active-client list UniFi Network's own pages read
  // (#502), else from the health summary, whose WiFi count can run higher.
  clients: { total: number; wireless: number; wired: number; guests: number };
  // UniFi devices: connected, adopted but out of reach, and waiting to be
  // adopted. Counted device by device (#467): the network gear from
  // stat/device, and other UniFi apps' devices (Protect cameras and the
  // like) from the device list UniFi Network's Devices page reads. The health
  // summary's tallies, the fallback when stat/device can't be read, count
  // roles, so a Dream Machine counts as a gateway and again as a switch.
  devices: { online: number; disconnected: number; pending: number };
  // Derived health issues, most severe first, capped for the card.
  issues: { level: "warning" | "error"; message: string }[];
};

export const UNIFI_ISSUE_CAP = 6;
const DEFAULT_SITE = "default";

// One UniFi device (an access point, switch, or gateway) for the detail page —
// the "which gear, and is it up" the health counts can't show.
export type UnifiDevice = {
  name: string;
  // A friendly kind ("Access Point" / "Switch" / "Gateway"), from the raw type.
  kind: string;
  up: boolean;
  // Clients associated to this device; null for another UniFi app's device.
  clients: number | null;
  // Uptime in seconds, or null when not reported (or another app's device,
  // whose uptime isn't read).
  uptime: number | null;
};

// The detail payload: the health snapshot plus the device list.
export type UnifiDetail = UnifiSnapshot & { deviceList: UnifiDevice[] };

export const UNIFI_DEVICE_CAP = 40;

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

type RawDevice = {
  name?: string;
  model?: string;
  mac?: string;
  type?: string;
  adopted?: boolean;
  // See deviceStatus.
  state?: number;
  num_sta?: number;
  uptime?: number;
  // Set here, not by the controller: the UniFi app (Protect, Access, ...) a
  // device from the v2 device list belongs to. Unset for network gear.
  app?: string;
};

// One entry of the v2 active-client list.
type RawClient = {
  type?: string;
  is_wired?: boolean;
  is_guest?: boolean;
};

const int = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;

// UniFi device type codes → a friendly kind.
const DEVICE_KINDS: Record<string, string> = {
  uap: "Access Point",
  usw: "Switch",
  ugw: "Gateway",
  udm: "Gateway",
  uxg: "Gateway",
  usg: "Gateway",
};

// The v2 device list's groups for the other UniFi apps → the kind their
// devices show as. A group not named here shows as "Device".
const APP_KINDS: Record<string, string> = {
  protect_devices: "Protect",
  access_devices: "Access",
  talk_devices: "Talk",
  connect_devices: "Connect",
  led_devices: "LED",
  drive_devices: "Drive",
};
// Groups that aren't another app's UniFi devices: the network gear, read
// from stat/device instead, and the third-party devices UniFi has seen but
// doesn't manage.
const NOT_APP_GROUPS = new Set(["network_devices", "unmanaged_devices"]);

// Where a device stands, from stat/device's `state`: 1 connected, and 4
// upgrading or 5 provisioning, which it does while connected; 2 pending and
// 7 adopting, as is any device not adopted yet; the rest (0 disconnected,
// 6 heartbeat missed, an inform or adoption error, isolated) out of reach.
// Other UniFi apps' devices in the v2 list read 1 connected and 0
// disconnected the same way.
type DeviceStatus = "online" | "offline" | "pending";
function deviceStatus(d: RawDevice): DeviceStatus {
  if (d.adopted === false || d.state === 2 || d.state === 7) return "pending";
  return d.state === 1 || d.state === 4 || d.state === 5 ? "online" : "offline";
}

// Exported for the unit tests: the device counts from stat/device (#467), or
// null when it didn't come back as a list.
export function countUnifiDevices(raw: unknown): UnifiSnapshot["devices"] | null {
  if (!Array.isArray(raw)) return null;
  const counts = { online: 0, disconnected: 0, pending: 0 };
  for (const d of raw as RawDevice[]) {
    if (!d || typeof d !== "object") continue;
    const status = deviceStatus(d);
    if (status === "online") counts.online += 1;
    else if (status === "pending") counts.pending += 1;
    else counts.disconnected += 1;
  }
  return counts;
}

// Exported for the unit tests: the client counts from the v2 active-client
// list (#502), or null when it didn't come back as a list. On a live
// controller the health summary counted 2 more WiFi clients than this list
// and UniFi Network's own pages. A client of another kind (neither WiFi nor
// wired) isn't counted, as the health summary's counts leave it out too.
export function countUnifiClients(raw: unknown): UnifiSnapshot["clients"] | null {
  if (!Array.isArray(raw)) return null;
  const counts = { total: 0, wireless: 0, wired: 0, guests: 0 };
  for (const c of raw as RawClient[]) {
    if (!c || typeof c !== "object") continue;
    const untyped = c.type === undefined;
    if (c.type === "WIRED" || (untyped && c.is_wired === true)) counts.wired += 1;
    else if (c.type === "WIRELESS" || (untyped && c.is_wired === false)) counts.wireless += 1;
    else continue;
    if (c.is_guest === true) counts.guests += 1;
  }
  counts.total = counts.wireless + counts.wired;
  return counts;
}

// Every UniFi device on the site (#467): the network gear from stat/device
// (else the v2 list's own network group), then the other UniFi apps' devices
// from the v2 device list, tagged with their app. Null when no list of the
// network gear came back.
function siteDevices(listed: unknown, byApp: unknown): RawDevice[] | null {
  const groups =
    byApp && typeof byApp === "object" && !Array.isArray(byApp)
      ? (byApp as Record<string, unknown>)
      : {};
  const network = Array.isArray(listed)
    ? listed
    : Array.isArray(groups.network_devices)
      ? groups.network_devices
      : null;
  if (!network) return null;
  const others = Object.entries(groups).flatMap(([group, list]) =>
    NOT_APP_GROUPS.has(group) || !Array.isArray(list)
      ? []
      : (list as unknown[])
          .filter((d): d is RawDevice => !!d && typeof d === "object")
          .map((d) => ({ ...d, app: APP_KINDS[group] ?? "Device" }))
  );
  return [...(network as RawDevice[]), ...others];
}

// Exported for the unit tests: fold stat/device into the detail's device list,
// offline gear first so a downed device surfaces at the top. Sorted before
// the cap, so an offline device late in a big network's list still makes the
// cut (#468).
export function mapUnifiDevices(raw: unknown): UnifiDevice[] {
  const list = Array.isArray(raw) ? (raw as RawDevice[]) : [];
  return list
    .map((d) => ({
      name: d.name?.trim() || d.model?.trim() || d.mac?.trim() || "device",
      kind: d.app ?? DEVICE_KINDS[d.type ?? ""] ?? (d.type?.trim() || "Device"),
      up: deviceStatus(d) === "online",
      clients: d.app ? null : int(d.num_sta),
      uptime: !d.app && typeof d.uptime === "number" && d.uptime > 0 ? d.uptime : null,
    }))
    .sort((a, b) => Number(a.up) - Number(b.up))
    .slice(0, UNIFI_DEVICE_CAP);
}

const SUBSYSTEM_LABELS: Record<string, string> = {
  wan: "WAN",
  www: "Internet",
  wlan: "WiFi",
  lan: "LAN",
  vpn: "VPN",
};

// Exported for the unit tests: fold the health subsystems into the snapshot,
// with the device and client counts from their lists when those were read.
export function mapUnifiHealth(
  raw: unknown,
  rawDevices?: unknown,
  rawClients?: unknown
): UnifiSnapshot {
  const subsystems = Array.isArray(raw) ? (raw as RawSubsystem[]) : [];
  const by = (name: string) => subsystems.find((s) => s.subsystem === name) ?? {};
  const wan = by("wan");
  const www = by("www");
  const wlan = by("wlan");
  const lan = by("lan");

  const wireless = int(wlan.num_user) + int(wlan.num_guest);
  const wired = int(lan.num_user) + int(lan.num_guest);
  const clients = countUnifiClients(rawClients) ?? {
    total: wireless + wired,
    wireless,
    wired,
    guests: int(wlan.num_guest) + int(lan.num_guest),
  };

  // Without the device list: UniFi gear lives on the wan (gateway), wlan
  // (APs), and lan (switches) subsystems, and their tallies add up to a
  // count of roles rather than devices.
  const infra = [wan, wlan, lan];
  const devices = countUnifiDevices(rawDevices) ?? {
    online: infra.reduce((n, s) => n + int(s.num_adopted), 0),
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
    clients,
    devices,
    issues: issues.slice(0, UNIFI_ISSUE_CAP),
  };
}

// --- Session cache (keyed by connection, mirrors qBittorrent's) ---

type Session = { cookie: string; prefix: string };

const sessions = globalSingleton(
  "__ctrlcenterUnifiSessions",
  () => new Map<string, Session>()
);
const loginsInFlight = globalSingleton(
  "__ctrlcenterUnifiLogins",
  () => new Map<string, Promise<Session>>()
);

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
    password: cfg.password,
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
  throwForStatus(result, {
    400: "Login failed — check the username and password",
    401: "Login failed — check the username and password",
    404: "Is the URL a UniFi controller?",
  });
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
  throwForStatus(res);
  return res.text;
}

function siteData<T>(text: string): T {
  const env = parseJson<RawEnvelope<T>>(text);
  return (env.data ?? []) as T;
}

// The site's health summary, and the lists beside it: the devices, for the
// card's device counts (#467) and the detail page's list (#231), and the
// active clients, for the card's client counts (#502). The v2 lists are the
// ones UniFi Network's own pages read; a controller without them (or a list
// that fails or doesn't parse) leaves the card on stat/device and the health
// summary rather than failing.
async function readSite(cfg: UnifiConfig): Promise<{
  health: RawSubsystem[];
  devices: RawDevice[] | null;
  clients: unknown;
}> {
  const base = serviceBase(cfg.url);
  const get = (path: string) => unifiGet(base, cfg, (p) => `${p}${path}`);
  const [healthR, devicesR, appDevicesR, clientsR] = await Promise.allSettled([
    get(`/api/s/${DEFAULT_SITE}/stat/health`),
    get(`/api/s/${DEFAULT_SITE}/stat/device`),
    get(`/v2/api/site/${DEFAULT_SITE}/device`),
    get(`/v2/api/site/${DEFAULT_SITE}/clients/active`),
  ]);
  if (healthR.status === "rejected") throw healthR.reason;
  // A list that failed or isn't JSON is treated as unread.
  const read = (r: PromiseSettledResult<string>, parse: (text: string) => unknown) => {
    if (r.status === "rejected") return null;
    try {
      return parse(r.value);
    } catch {
      return null;
    }
  };
  return {
    health: siteData<RawSubsystem[]>(healthR.value),
    devices: siteDevices(read(devicesR, siteData), read(appDevicesR, parseJson)),
    clients: read(clientsR, parseJson),
  };
}

export async function getUnifiSnapshot(cfg: UnifiConfig): Promise<UnifiSnapshot> {
  const { health, devices, clients } = await readSite(cfg);
  return mapUnifiHealth(health, devices, clients);
}

// The detail read (#231): the health snapshot plus the adopted-device list. A
// failed device fetch degrades to an empty list rather than blanking the page.
export async function getUnifiDetail(cfg: UnifiConfig): Promise<UnifiDetail> {
  const { health, devices, clients } = await readSite(cfg);
  return {
    ...mapUnifiHealth(health, devices, clients),
    deviceList: mapUnifiDevices(devices ?? []),
  };
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
