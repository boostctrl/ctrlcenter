import fs from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { log, errorReason } from "./log";
import { globalSingleton } from "./singleton";

// Server-side admin session records (#365). A session cookie used to be a
// bare signed token: valid for seven days from sign-in however idle, and
// revocable only by changing the password (logout just dropped the cookie).
// Every session now has a record here, keyed by the token's `jti`, and the
// token verifies only while its record exists — so logout, "sign out
// everywhere" and the idle timeout actually end a session, and the admin can
// see which sessions are open.
//
// Kept in `sessions.json` beside config.yaml (the same volume the session
// secret lives in), so sessions survive a restart. A volume that can't hold
// the file degrades to an in-memory list: sessions then end with the
// process, which is the safe direction.

export type SessionRecord = {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  // The client address at sign-in (null when it can't be told apart), and
  // the browser's User-Agent, for the active-sessions list only.
  ip: string | null;
  userAgent: string;
  // How the sign-in arrived, for the security checklist (#367): over HTTPS
  // (directly or via a TLS-terminating proxy), and whether it reached the
  // server with an X-Forwarded-For header (so through a proxy) — null when
  // the app couldn't tell, as outside the Docker image's entry (#383).
  https: boolean;
  forwarded: boolean | null;
  // When the session last proved the password (and the second factor when
  // on): at sign-in, then each step-up confirmation (#366).
  reauthAt: number;
  // Addresses other than the sign-in's that the session was used from
  // (#382), each announced once when first seen. Bounded; absent when none.
  addresses?: string[];
};

export type SessionMeta = {
  ip: string | null;
  userAgent: string;
  https?: boolean;
  forwarded?: boolean | null;
};

// Defaults and bounds for the idle timeout: a session unused for this long
// ends. The absolute lifetime stays SESSION_MAX_AGE (lib/auth.ts); the token's
// own expiry enforces that.
export const DEFAULT_IDLE_HOURS = 24;
export const MIN_IDLE_HOURS = 1;
export const MAX_IDLE_HOURS = 24 * 7;
export const ABSOLUTE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// lastSeenAt is written at most this often per session, so a busy admin tab
// doesn't rewrite the file on every request.
const TOUCH_INTERVAL_MS = 60 * 1000;

const FILE_NAME = "sessions.json";

// Version 2 (#383) records `forwarded` as null when unknown. Version 1 took it
// from an X-Forwarded-For header Next fills in on every request, so every
// record said true: those read as unknown rather than keep that verdict.
const FILE_VERSION = 2;

type StoreFile = { version: number; idleHours: number; sessions: SessionRecord[] };

type Store = {
  file: string;
  idleHours: number;
  sessions: Map<string, SessionRecord>;
  loaded: Promise<void> | null;
  // Serialized writes, so two revocations can't interleave their rewrites.
  writes: Promise<void>;
  // Whether the volume took the last write; one warning per store, not per
  // request, when it can't.
  persistFailed: boolean;
};

// Per file path (tests point CONFIG_PATH at scratch directories); a
// process-wide singleton so every route bundle shares one list.
const stores = globalSingleton(
  "__ctrlcenterSessions",
  () => new Map<string, Store>()
);

// Resolved lazily (not at module load) so tests can point CONFIG_PATH at a
// scratch directory. Untraced like CONFIG_PATH in lib/config/store.ts.
function storePath(): string {
  const configPath =
    process.env.CONFIG_PATH ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "config", "config.yaml");
  return path.join(path.dirname(configPath), FILE_NAME);
}

function clampIdleHours(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : DEFAULT_IDLE_HOURS;
  return Math.min(MAX_IDLE_HOURS, Math.max(MIN_IDLE_HOURS, n));
}

function isRecord(v: unknown): v is SessionRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id !== "" &&
    typeof r.createdAt === "number" &&
    typeof r.lastSeenAt === "number" &&
    (r.ip === null || typeof r.ip === "string") &&
    typeof r.userAgent === "string"
  );
}

// A stored record, with the fields an older file lacks (or got wrong)
// defaulted.
function normalize(r: SessionRecord, version: unknown): SessionRecord {
  return {
    ...r,
    https: r.https === true,
    forwarded:
      typeof version === "number" && version >= 2 && typeof r.forwarded === "boolean"
        ? r.forwarded
        : null,
    reauthAt: typeof r.reauthAt === "number" ? r.reauthAt : r.createdAt,
    ...(Array.isArray(r.addresses) && r.addresses.every((a) => typeof a === "string")
      ? { addresses: r.addresses }
      : {}),
  };
}

async function load(store: Store): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(store.file, "utf8");
  } catch (e) {
    // A missing file is the first run; anything else (a volume that isn't a
    // directory, odd permissions) means in-memory only.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn(`sessions file unreadable, sessions end with the process: ${errorReason(e)}`);
    }
    return;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    store.idleHours = clampIdleHours(parsed.idleHours);
    for (const s of Array.isArray(parsed.sessions) ? parsed.sessions : []) {
      if (isRecord(s)) store.sessions.set(s.id, normalize(s, parsed.version));
    }
  } catch (e) {
    log.warn(`sessions file unparseable, starting empty: ${errorReason(e)}`);
  }
}

function getStore(): Store {
  const file = storePath();
  let store = stores.get(file);
  if (!store) {
    store = {
      file,
      idleHours: DEFAULT_IDLE_HOURS,
      sessions: new Map(),
      loaded: null,
      writes: Promise.resolve(),
      persistFailed: false,
    };
    stores.set(file, store);
  }
  return store;
}

async function ready(): Promise<Store> {
  const store = getStore();
  if (!store.loaded) store.loaded = load(store);
  await store.loaded;
  return store;
}

// Write the whole list atomically (temp file + rename, mode 0600: the file
// names open sessions by id, which is what a cookie carries).
function persist(store: Store): Promise<void> {
  const snapshot: StoreFile = {
    version: FILE_VERSION,
    idleHours: store.idleHours,
    sessions: [...store.sessions.values()],
  };
  const write = store.writes.then(async () => {
    const tmp = `${store.file}.${process.pid}.tmp`;
    try {
      await fs.mkdir(path.dirname(store.file), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(snapshot), { mode: 0o600 });
      await fs.rename(tmp, store.file);
      store.persistFailed = false;
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      if (!store.persistFailed) {
        log.warn(`can't persist sessions, they end with the process: ${errorReason(e)}`);
      }
      store.persistFailed = true;
    }
  });
  store.writes = write;
  return write;
}

function expired(store: Store, s: SessionRecord, now: number): boolean {
  return (
    now - s.lastSeenAt > store.idleHours * 60 * 60 * 1000 ||
    now - s.createdAt > ABSOLUTE_MAX_AGE_MS
  );
}

// Drop every expired record; true when something was removed.
function prune(store: Store, now: number): boolean {
  let changed = false;
  for (const s of store.sessions.values()) {
    if (expired(store, s, now)) {
      store.sessions.delete(s.id);
      changed = true;
    }
  }
  return changed;
}

// Start a session: a fresh random id for the token's `jti`, and the record
// behind it.
export async function createSession(meta: SessionMeta, now = Date.now()): Promise<string> {
  const store = await ready();
  const id = randomBytes(18).toString("base64url");
  store.sessions.set(id, {
    id,
    createdAt: now,
    lastSeenAt: now,
    ip: meta.ip,
    // Bounded: the header is client-chosen and the list renders it.
    userAgent: meta.userAgent.slice(0, 300),
    https: meta.https === true,
    forwarded: meta.forwarded ?? null,
    reauthAt: now,
  });
  prune(store, now);
  await persist(store);
  return id;
}

// The record for a live session, marking it seen, or null when it has been
// revoked or sat idle past the timeout (the record is dropped then). Called
// on every authenticated request, so the write behind it is throttled.
export async function touchSession(id: string, now = Date.now()): Promise<SessionRecord | null> {
  const store = await ready();
  const s = store.sessions.get(id);
  if (!s) return null;
  if (expired(store, s, now)) {
    store.sessions.delete(id);
    void persist(store);
    return null;
  }
  if (now - s.lastSeenAt >= TOUCH_INTERVAL_MS) {
    s.lastSeenAt = now;
    void persist(store);
  }
  return s;
}

// Note that a live session was used from `ip`, an address other than its
// sign-in's (#382). True the first time that address is seen on this session,
// which is the moment to announce it; false after, or for a dead session.
// Keeps the last few, so a phone moving between networks is noted once per
// network rather than on every request.
const MAX_SESSION_ADDRESSES = 8;
export async function noteSessionAddress(id: string, ip: string): Promise<boolean> {
  const store = await ready();
  const s = store.sessions.get(id);
  if (!s || s.ip === ip || s.addresses?.includes(ip)) return false;
  s.addresses = [...(s.addresses ?? []), ip].slice(-MAX_SESSION_ADDRESSES);
  await persist(store);
  return true;
}

// The record for a live session without marking it seen.
export async function getSession(id: string, now = Date.now()): Promise<SessionRecord | null> {
  const store = await ready();
  const s = store.sessions.get(id);
  if (!s) return null;
  if (expired(store, s, now)) {
    store.sessions.delete(id);
    void persist(store);
    return null;
  }
  return s;
}

// Every live session, most recently seen first.
export async function listSessions(now = Date.now()): Promise<SessionRecord[]> {
  const store = await ready();
  if (prune(store, now)) void persist(store);
  return [...store.sessions.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

// End one session: its token stops verifying on the next request.
export async function revokeSession(id: string): Promise<boolean> {
  const store = await ready();
  const had = store.sessions.delete(id);
  if (had) await persist(store);
  return had;
}

// End every session but one ("sign out everywhere else"), or every session
// when `keep` is omitted (a password change, "sign out everywhere"). Returns
// how many ended.
export async function revokeSessions(keep?: string): Promise<number> {
  const store = await ready();
  let count = 0;
  for (const id of [...store.sessions.keys()]) {
    if (id === keep) continue;
    store.sessions.delete(id);
    count += 1;
  }
  if (count > 0) await persist(store);
  return count;
}

// Record that a live session just re-proved its credentials (#366), so the
// step-up gate lets sensitive actions through for a while.
export async function markReauth(id: string, now = Date.now()): Promise<boolean> {
  const store = await ready();
  const s = store.sessions.get(id);
  if (!s || expired(store, s, now)) return false;
  s.reauthAt = now;
  await persist(store);
  return true;
}

// The idle timeout, in hours.
export async function getIdleHours(): Promise<number> {
  return (await ready()).idleHours;
}

export async function setIdleHours(hours: number): Promise<number> {
  const store = await ready();
  store.idleHours = clampIdleHours(hours);
  // A shorter timeout applies to sessions already idle past it.
  prune(store, Date.now());
  await persist(store);
  return store.idleHours;
}

// Whether the volume is holding the sessions file (false after a failed
// write: sessions then end with the process). For the security checklist.
export async function sessionsPersisted(): Promise<boolean> {
  const store = await ready();
  return !store.persistFailed;
}
