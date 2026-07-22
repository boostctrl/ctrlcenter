// Typed client for the qBittorrent WebUI API (#190). Server-side only — calls
// happen inside admin-gated routes via the monitor cache, and the credentials
// never reach the browser. qBittorrent authenticates with a session cookie
// (SID) minted by /api/v2/auth/login; the cookie is cached per connection on
// globalThis (lib module state forks per route bundle) and re-minted once on a
// 403, so an expired session heals without surfacing an error.

import {
  ServiceError,
  serviceBase,
  serviceRequest,
  parseJson,
  runProbe,
  type ProbeResult,
} from "./http";

export type QbittorrentConfig = {
  url: string;
  username: string;
  password: string;
};

// The password can come from the environment instead of config.yaml, same
// convention as CTRLCENTER_SMTP_PASS / CTRLCENTER_CALDAV_PASS.
export function resolveQbittorrentPassword(cfg: {
  password: string;
}): string {
  return process.env.CTRLCENTER_QBITTORRENT_PASS || cfg.password;
}

// qBittorrent reports ~15 raw states; the cards need far fewer. Buckets:
// moving data now / seeding / deliberately stopped / waiting its turn /
// verifying / no peers / broken.
export type TorrentState =
  | "downloading"
  | "seeding"
  | "paused"
  | "queued"
  | "checking"
  | "stalled"
  | "error";

export type QbittorrentTorrent = {
  name: string;
  state: TorrentState;
  // Completion 0..1.
  progress: number;
  ratio: number;
  // bytes/s
  downSpeed: number;
  upSpeed: number;
  // bytes
  size: number;
  // Seconds remaining; null when idle or unknown.
  eta: number | null;
};

export type QbittorrentSnapshot = {
  // Overall transfer rates (bytes/s).
  downSpeed: number;
  upSpeed: number;
  counts: {
    total: number;
    downloading: number;
    seeding: number;
    paused: number;
    errored: number;
  };
  // The most interesting torrents — actively transferring first, then
  // unfinished downloads — capped for the card.
  torrents: QbittorrentTorrent[];
};

// How many torrents the snapshot carries. The card is a glanceable summary,
// not a torrent manager; the full list lives in qBittorrent itself.
export const TORRENT_LIST_CAP = 8;

// qBittorrent reports this ETA when there is no estimate (100 days).
const ETA_INFINITY = 8640000;

const STATE_BUCKETS: Record<string, TorrentState> = {
  downloading: "downloading",
  metaDL: "downloading",
  forcedDL: "downloading",
  allocating: "downloading",
  uploading: "seeding",
  forcedUP: "seeding",
  stalledUP: "seeding", // seeding with no takers — still "done and sharing"
  stalledDL: "stalled",
  queuedDL: "queued",
  queuedUP: "queued",
  checkingDL: "checking",
  checkingUP: "checking",
  checkingResumeData: "checking",
  moving: "checking",
  pausedDL: "paused",
  pausedUP: "paused",
  // qBittorrent 5 renamed paused* to stopped*.
  stoppedDL: "paused",
  stoppedUP: "paused",
  error: "error",
  missingFiles: "error",
};

// Exported for the state-mapping unit tests. An unknown raw state (a future
// qBittorrent version) degrades to "stalled" — neutral, never alarming.
export function simplifyTorrentState(raw: string): TorrentState {
  return STATE_BUCKETS[raw] ?? "stalled";
}

// --- Session cookie cache ---

// Keyed by connection (base URL + user), NOT including the password: a
// password change just makes the next 403 re-login with the new one. The
// in-flight map dedupes concurrent logins — a snapshot fires its endpoint
// calls in parallel, and each would otherwise mint its own session.
const g = globalThis as unknown as {
  __ctrlcenterQbitSessions?: Map<string, string>;
  __ctrlcenterQbitLogins?: Map<string, Promise<string>>;
};
const sessions = (g.__ctrlcenterQbitSessions ??= new Map());
const loginsInFlight = (g.__ctrlcenterQbitLogins ??= new Map());

function sessionKey(base: string, username: string): string {
  return `${base}|${username}`;
}

function login(base: string, cfg: QbittorrentConfig): Promise<string> {
  const key = sessionKey(base, cfg.username);
  const running = loginsInFlight.get(key);
  if (running) return running;
  const run = mintSession(base, cfg).finally(() => loginsInFlight.delete(key));
  loginsInFlight.set(key, run);
  return run;
}

// Mint a session cookie. qBittorrent wants a form body and (with CSRF
// protection on) a same-origin Referer; it answers 200 "Fails." on bad
// credentials and 403 when the source IP is temporarily banned.
async function mintSession(
  base: string,
  cfg: QbittorrentConfig
): Promise<string> {
  const { res, text } = await serviceRequest(`${base}/api/v2/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: base,
    },
    body: new URLSearchParams({
      username: cfg.username,
      password: resolveQbittorrentPassword(cfg),
    }).toString(),
  });
  if (res.status === 403) {
    throw new ServiceError("Login refused — IP temporarily banned?");
  }
  if (!res.ok) throw new ServiceError(`HTTP ${res.status}`);
  if (!/^Ok\.?$/i.test(text.trim())) {
    throw new ServiceError("Login failed — check the username and password");
  }
  const sid = /SID=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
  if (!sid) {
    throw new ServiceError("Login succeeded but no session cookie came back");
  }
  const cookie = `SID=${sid}`;
  sessions.set(sessionKey(base, cfg.username), cookie);
  return cookie;
}

// GET an authenticated endpoint, logging in on a missing/expired session.
// Exactly one retry: a 403 straight after a fresh login is a real error.
async function qbitRequest(
  base: string,
  cfg: QbittorrentConfig,
  path: string
): Promise<string> {
  const key = sessionKey(base, cfg.username);
  let cookie = sessions.get(key) ?? (await login(base, cfg));
  let { res, text } = await serviceRequest(`${base}${path}`, {
    headers: { Cookie: cookie, Referer: base },
  });
  if (res.status === 403) {
    cookie = await login(base, cfg);
    ({ res, text } = await serviceRequest(`${base}${path}`, {
      headers: { Cookie: cookie, Referer: base },
    }));
  }
  if (!res.ok) throw new ServiceError(`HTTP ${res.status}`);
  return text;
}

// --- Raw API shapes (only the fields the snapshot uses) ---

type RawTransfer = { dl_info_speed?: number; up_info_speed?: number };
type RawTorrent = {
  name?: string;
  state?: string;
  progress?: number;
  ratio?: number;
  dlspeed?: number;
  upspeed?: number;
  size?: number;
  eta?: number;
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Sort key: actively transferring first (fastest first), then unfinished
// ahead of finished, then name — so the capped list surfaces what's moving.
function interest(t: QbittorrentTorrent): number {
  return (
    (t.downSpeed + t.upSpeed > 0 ? 2 : 0) + (t.progress < 1 ? 1 : 0)
  );
}

export async function getQbittorrentSnapshot(
  cfg: QbittorrentConfig
): Promise<QbittorrentSnapshot> {
  const base = serviceBase(cfg.url);
  const [transferText, torrentsText] = await Promise.all([
    qbitRequest(base, cfg, "/api/v2/transfer/info"),
    qbitRequest(base, cfg, "/api/v2/torrents/info"),
  ]);
  const transfer = parseJson<RawTransfer>(transferText);
  const raw = parseJson<RawTorrent[]>(torrentsText);
  const rows = Array.isArray(raw) ? raw : [];

  const torrents = rows.map(
    (t): QbittorrentTorrent => ({
      name: typeof t.name === "string" ? t.name : "(unnamed)",
      state: simplifyTorrentState(typeof t.state === "string" ? t.state : ""),
      progress: Math.min(1, Math.max(0, num(t.progress))),
      ratio: num(t.ratio),
      downSpeed: num(t.dlspeed),
      upSpeed: num(t.upspeed),
      size: num(t.size),
      eta:
        typeof t.eta === "number" && t.eta > 0 && t.eta < ETA_INFINITY
          ? t.eta
          : null,
    })
  );

  const counts = {
    total: torrents.length,
    downloading: 0,
    seeding: 0,
    paused: 0,
    errored: 0,
  };
  for (const t of torrents) {
    // "downloading" is the active download phase only — actually downloading,
    // or stalled (wants data, no peers right now). Queued and checking are
    // deliberately NOT counted here: a queue-capped client sitting at 0 B/s
    // must not read as "N downloading" when nothing is moving (they still
    // count toward `total`). error is its own bucket so they don't fall into
    // it either.
    if (t.state === "downloading" || t.state === "stalled")
      counts.downloading += 1;
    else if (t.state === "seeding") counts.seeding += 1;
    else if (t.state === "paused") counts.paused += 1;
    else if (t.state === "error") counts.errored += 1;
  }

  const list = [...torrents]
    .sort(
      (a, b) =>
        interest(b) - interest(a) ||
        b.downSpeed + b.upSpeed - (a.downSpeed + a.upSpeed) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, TORRENT_LIST_CAP);

  return {
    downSpeed: num(transfer.dl_info_speed),
    upSpeed: num(transfer.up_info_speed),
    counts,
    torrents: list,
  };
}

// Fresh reachability check for the admin's "Test connection" button: a real
// login plus the version endpoint, so success proves the credentials, not
// just that something answered.
export async function probeQbittorrent(
  cfg: QbittorrentConfig
): Promise<ProbeResult> {
  return runProbe("qbittorrent", async () => {
    const base = serviceBase(cfg.url);
    const key = sessionKey(base, cfg.username);
    // Probe with fresh credentials — not a cached session, and not a login
    // already in flight for the OLD password. login() dedupes on base+username
    // only (ignoring the password), so without clearing the in-flight entry a
    // probe fired while a background poll's stale-password login is running
    // would adopt that promise and validate the wrong credentials.
    sessions.delete(key);
    loginsInFlight.delete(key);
    const version = await qbitRequest(base, cfg, "/api/v2/app/version");
    return `qBittorrent ${version.trim()}`.trim();
  });
}
