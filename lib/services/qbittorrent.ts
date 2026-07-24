// Typed client for the qBittorrent WebUI API (#190). Server-side only — calls
// happen inside admin-gated routes via the monitor cache, and the credentials
// never reach the browser. qBittorrent authenticates with a session cookie
// minted by /api/v2/auth/login (named `SID` through 5.1, `QBT_SID_<port>` from
// 5.2); the cookie is cached per connection on globalThis (lib module state
// forks per route bundle) and re-minted once on a 403, so an expired session
// heals without surfacing an error.
//
// The snapshot polls /sync/maindata, qBittorrent's incremental endpoint: the
// first call (rid 0) returns the whole torrent map and server counters, and
// each later call returns only what changed since the rid we last saw. The
// maintained view lives per connection on globalThis, so a large seedbox ships
// its full list once rather than re-parsing multi-MB of JSON every poll (#210).

import {
  ServiceError,
  serviceBase,
  serviceRequest,
  parseJson,
  runProbe,
  type ProbeResult,
} from "./http";
import { resolveSecret } from "../secrets";
import { log, hostOf } from "../log";

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
  return resolveSecret("CTRLCENTER_QBITTORRENT_PASS", cfg.password);
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

// The card's per-state tally (total / downloading / seeding / paused) needs
// every torrent, so the first /sync/maindata call returns the whole map — and
// on a large instance that JSON runs well past the default SERVICE_MAX_BYTES,
// which would surface as a "Response too large" error that killed the whole
// card. Give the maindata call a much larger budget (~16k torrents at ~2 KB
// each) for that initial full sync; steady-state deltas are tiny. Server-side
// and admin-only, so the memory cost is bounded to one instance's torrents.
export const QBITTORRENT_MAX_BYTES = 32 * 1024 * 1024;

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
  __ctrlcenterQbitSync?: Map<string, QbitSyncState>;
  __ctrlcenterQbitSyncLocks?: Map<string, Promise<QbitSyncState>>;
};
const sessions = (g.__ctrlcenterQbitSessions ??= new Map());
const loginsInFlight = (g.__ctrlcenterQbitLogins ??= new Map());
// The maintained /sync/maindata view per connection, plus a per-connection
// lock so two concurrent polls can't both consume the same rid (which would
// drop the delta the loser never applied).
const syncStates = (g.__ctrlcenterQbitSync ??= new Map());
const syncLocks = (g.__ctrlcenterQbitSyncLocks ??= new Map());

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
  const body = text.trim();
  // qBittorrent <5.2 answers 200 with "Ok."/"Fails." in the body; 5.2+ answers
  // 204 No Content with an empty body on a successful login — the session
  // cookie still comes back either way (#215). Accept the 204; otherwise
  // require the "Ok." body, keeping the specific messages below for failures.
  if (res.status !== 204 && !/^Ok\.?$/i.test(body)) {
    if (body === "") {
      // A 2xx with no body that ISN'T the 5.2+ 204 — the URL isn't reaching a
      // qBittorrent WebUI (wrong port, or a middlebox).
      throw new ServiceError("Empty response — is the URL a qBittorrent WebUI?");
    }
    // "Fails." (or anything unexpected) — qBittorrent answers 200 even on bad
    // credentials, so a non-"Ok." body is a real login failure.
    throw new ServiceError("Login failed — check the username and password");
  }
  // qBittorrent normally issues a session cookie on login. But when the WebUI
  // is set to bypass authentication for this client ("Bypass authentication
  // for clients on localhost" / for whitelisted subnets), a successful login
  // returns no cookie because none is needed. Proceed cookieless rather than
  // failing — the API calls then go through unauthenticated. A qBittorrent
  // that genuinely requires the cookie still surfaces clearly as an HTTP 403
  // on the data call, not here.
  const sessionCookie = extractSessionCookie(res.headers);
  if (!sessionCookie) {
    log.info(
      "qbittorrent login returned no session cookie — treating this client as auth-exempt",
      { host: hostOf(base) }
    );
  }
  const cookie = sessionCookie ?? "";
  sessions.set(sessionKey(base, cfg.username), cookie);
  return cookie;
}

// The WebUI's session cookie as a replayable `name=value` pair. qBittorrent
// named it `SID` through 5.1 and renamed it to `QBT_SID_<port>` in 5.2 (with
// HttpOnly; SameSite=Strict) — matching only `SID` is why a 5.2 login looked
// cookieless and every data call then 403'd (#217). Match either name and
// keep the whole pair so the cookie is replayed verbatim, name and all.
// getSetCookie() keeps multiple Set-Cookie headers separate (get("set-cookie")
// would comma-join them). Returns null when no session cookie is present (an
// auth-exempt WebUI).
function extractSessionCookie(headers: Headers): string | null {
  const cookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : ((c) => (c ? [c] : []))(headers.get("set-cookie"));
  for (const raw of cookies) {
    const pair = raw.split(";", 1)[0].trim(); // "NAME=VALUE", attributes dropped
    const name = pair.split("=", 1)[0];
    if (name === "SID" || /^QBT_SID_\d+$/.test(name)) return pair;
  }
  return null;
}

// GET an authenticated endpoint, logging in on a missing/expired session.
// Exactly one retry: a 403 straight after a fresh login is a real error.
// `maxBytes` lets the large torrent-list call raise the body cap without
// widening it for the small endpoints.
async function qbitRequest(
  base: string,
  cfg: QbittorrentConfig,
  path: string,
  maxBytes?: number
): Promise<string> {
  const key = sessionKey(base, cfg.username);
  // An empty cookie means the session is auth-exempt (see mintSession); send
  // no Cookie header at all in that case.
  const headersFor = (cookie: string): Record<string, string> =>
    cookie ? { Cookie: cookie, Referer: base } : { Referer: base };
  let cookie = sessions.get(key) ?? (await login(base, cfg));
  let { res, text } = await serviceRequest(
    `${base}${path}`,
    { headers: headersFor(cookie) },
    maxBytes
  );
  if (res.status === 403) {
    cookie = await login(base, cfg);
    ({ res, text } = await serviceRequest(
      `${base}${path}`,
      { headers: headersFor(cookie) },
      maxBytes
    ));
  }
  if (!res.ok) throw new ServiceError(`HTTP ${res.status}`);
  return text;
}

// --- Raw API shapes (only the fields the snapshot uses) ---

// The server-wide counters from maindata's server_state (overall rates).
type RawServerState = { dl_info_speed?: number; up_info_speed?: number };
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

// One /sync/maindata response. A full sync (rid 0, or after the server drops
// our rid) carries `full_update` with the whole torrent map and server_state;
// later responses carry only the torrents/fields that changed, a
// `torrents_removed` list, and a server_state delta.
type MaindataResponse = {
  rid?: number;
  full_update?: boolean;
  torrents?: Record<string, Partial<RawTorrent>>;
  torrents_removed?: string[];
  server_state?: Partial<RawServerState>;
};

// The maintained per-connection view, advanced by each maindata delta.
export type QbitSyncState = {
  rid: number;
  torrents: Map<string, RawTorrent>;
  serverState: RawServerState;
};

// Fold one maindata response into the prior state (pure, so the merge is unit
// tested directly). A full update — or a cold prior — resets the maps;
// otherwise each partial torrent merges over its last-known object, removed
// hashes drop out, and the server_state delta merges too. rid carries forward
// when the response omits it.
export function applyMaindata(
  prev: QbitSyncState | null,
  res: MaindataResponse
): QbitSyncState {
  const full = res.full_update === true || prev === null;
  const torrents = full
    ? new Map<string, RawTorrent>()
    : new Map(prev!.torrents);
  const serverState: RawServerState = full ? {} : { ...prev!.serverState };
  if (res.torrents) {
    for (const [hash, partial] of Object.entries(res.torrents)) {
      torrents.set(hash, { ...(torrents.get(hash) ?? {}), ...partial });
    }
  }
  if (res.torrents_removed) {
    for (const hash of res.torrents_removed) torrents.delete(hash);
  }
  if (res.server_state) Object.assign(serverState, res.server_state);
  return {
    rid: typeof res.rid === "number" ? res.rid : prev?.rid ?? 0,
    torrents,
    serverState,
  };
}

// One incremental maindata step for a connection: fetch the delta since our
// last rid, fold it in, and store the advanced state. Serialized per connection
// via a lock so concurrent polls share one fetch instead of both consuming the
// same rid. A failed fetch throws before the store is touched, so the rid stays
// put and the next poll simply re-requests the same delta.
function syncMaindata(
  base: string,
  cfg: QbittorrentConfig
): Promise<QbitSyncState> {
  const key = sessionKey(base, cfg.username);
  const running = syncLocks.get(key);
  if (running) return running;
  const run = (async () => {
    const prev = syncStates.get(key) ?? null;
    const rid = prev?.rid ?? 0;
    const text = await qbitRequest(
      base,
      cfg,
      `/api/v2/sync/maindata?rid=${rid}`,
      QBITTORRENT_MAX_BYTES
    );
    const next = applyMaindata(prev, parseJson<MaindataResponse>(text));
    syncStates.set(key, next);
    return next;
  })().finally(() => syncLocks.delete(key));
  syncLocks.set(key, run);
  return run;
}

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
  const state = await syncMaindata(base, cfg);
  const rows = [...state.torrents.values()];

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
    downSpeed: num(state.serverState.dl_info_speed),
    upSpeed: num(state.serverState.up_info_speed),
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
    // Also drop any maintained sync state, so a re-test after editing the
    // connection starts from a fresh full sync rather than an old rid.
    syncStates.delete(key);
    const version = await qbitRequest(base, cfg, "/api/v2/app/version");
    return `qBittorrent ${version.trim()}`.trim();
  });
}
