import fs from "fs/promises";
import path from "path";
import type { NextRequest } from "next/server";
import { log, errorReason } from "./log";
import { globalSingleton } from "./singleton";
import { clientIp, throttleBucket } from "./rate-limit";
import { FOUNDING_ACCOUNT_ID } from "./schema/auth";

// The security audit log (#368): sign-ins and failed bursts, sign-outs,
// sessions ended, password and second-factor changes, step-up
// confirmations, secret exports, credential edits and dashboard actions —
// each with when, from where and from what browser. Never a password or a
// code. Settings → Security shows the recent entries; the alert channels
// relay the ones worth a notification (lib/security-alerts.ts).
//
// Kept as `security-events.jsonl` beside config.yaml, one entry per line,
// newest last, capped so it can't grow without bound. A volume that can't
// hold the file degrades to this process's memory.

export const SECURITY_EVENT_KINDS = [
  "signin.ok",
  "signin.fail",
  "signin.locked",
  "signout",
  "session.ended",
  "sessions.ended",
  "password.changed",
  "totp.enabled",
  "totp.disabled",
  "reauth.ok",
  "reauth.fail",
  "password.fail",
  "session.moved",
  "secret.revealed",
  "export.secrets",
  "integration.changed",
  "actions.enabled",
  "action",
] as const;
export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];

export type SecurityEvent = {
  at: number;
  kind: SecurityEventKind;
  ip: string | null;
  userAgent: string;
  // A short, non-secret specific: which integration, which action.
  detail?: string;
  // Repeated failures from one address within a few minutes fold into one
  // entry with a count, so a guessing run is one line, not fifty.
  count?: number;
  // How many addresses a folded entry covers, when a flood of failures from
  // many addresses folded into one line (#392). Absent for one address.
  addresses?: number;
  // A successful sign-in from an address no sign-in of this account used
  // in the last 30 days — the one worth a notification.
  newAddress?: boolean;
  // The account the entry is about (#423): the one that signed in or was
  // tried, changed its password, and so on. Absent in an entry 3.0 wrote
  // (the founding admin's) and for events about no account in particular.
  account?: string;
};

export type EventMeta = { ip: string | null; userAgent: string; account?: string };

// Caps: entries kept, how far back a listing reaches, and the windows for
// folding repeated failures and for "new address".
export const MAX_EVENTS = 1000;
export const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
const FOLD_MS = 5 * 60 * 1000;
const NEW_ADDRESS_MS = 30 * 24 * 60 * 60 * 1000;
const FOLDABLE: ReadonlySet<SecurityEventKind> = new Set([
  "signin.fail",
  "reauth.fail",
  "password.fail",
]);
// Once this many entries of one foldable kind have landed within FOLD_MS,
// further ones fold into the last entry whatever their address (#392): a run
// from many addresses becomes one line that counts them, instead of pushing
// the rest of the log out past its cap.
const FLOOD_ENTRIES = 20;

const FILE_NAME = "security-events.jsonl";

type Store = {
  file: string;
  events: SecurityEvent[];
  loaded: Promise<void> | null;
  writes: Promise<void>;
  persistFailed: boolean;
};

const stores = globalSingleton(
  "__ctrlcenterSecurityEvents",
  () => new Map<string, Store>()
);

function storePath(): string {
  const configPath =
    process.env.CONFIG_PATH ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "config", "config.yaml");
  return path.join(path.dirname(configPath), FILE_NAME);
}

function isEvent(v: unknown): v is SecurityEvent {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.at === "number" &&
    typeof e.kind === "string" &&
    (SECURITY_EVENT_KINDS as readonly string[]).includes(e.kind) &&
    (e.ip === null || typeof e.ip === "string") &&
    typeof e.userAgent === "string"
  );
}

async function load(store: Store): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(store.file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn(`security log unreadable, keeping it in memory: ${errorReason(e)}`);
    }
    return;
  }
  const cutoff = Date.now() - KEEP_MS;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (isEvent(parsed) && parsed.at >= cutoff) store.events.push(parsed);
    } catch {
      // A torn last line after a crash: skip it.
    }
  }
  store.events.sort((a, b) => a.at - b.at);
  if (store.events.length > MAX_EVENTS) store.events.splice(0, store.events.length - MAX_EVENTS);
}

async function ready(): Promise<Store> {
  const file = storePath();
  let store = stores.get(file);
  if (!store) {
    store = { file, events: [], loaded: null, writes: Promise.resolve(), persistFailed: false };
    stores.set(file, store);
  }
  if (!store.loaded) store.loaded = load(store);
  await store.loaded;
  return store;
}

// Rewrite the whole file atomically (temp + rename, mode 0600): at most
// MAX_EVENTS short lines, and a fold edits the last entry in place.
function persist(store: Store): Promise<void> {
  const snapshot = store.events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  const write = store.writes.then(async () => {
    const tmp = `${store.file}.${process.pid}.tmp`;
    try {
      await fs.mkdir(path.dirname(store.file), { recursive: true });
      await fs.writeFile(tmp, snapshot, { mode: 0o600 });
      await fs.rename(tmp, store.file);
      store.persistFailed = false;
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      if (!store.persistFailed) {
        log.warn(`can't persist the security log, keeping it in memory: ${errorReason(e)}`);
      }
      store.persistFailed = true;
    }
  });
  store.writes = write;
  return write;
}

// The client facts a request contributes: its address (as the login
// throttle resolves it) and browser.
export function eventMeta(request: NextRequest, account?: string): EventMeta {
  return {
    ip: clientIp(request),
    userAgent: (request.headers.get("user-agent") ?? "").slice(0, 300),
    ...(account ? { account } : {}),
  };
}

// The account an entry is about, the founding admin's when it names none.
export function eventAccount(e: Pick<SecurityEvent, "account">): string {
  return e.account ?? FOUNDING_ACCOUNT_ID;
}

// Whether two addresses count as one source: the same, or in the same
// throttle bucket (an IPv6 /64).
function sameSource(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  return a !== null && b !== null && throttleBucket(a) === throttleBucket(b);
}

// Whether `kind` already has FLOOD_ENTRIES entries inside the fold window.
function flooding(events: SecurityEvent[], kind: SecurityEventKind, now: number): boolean {
  let n = 0;
  for (let i = events.length - 1; i >= 0 && now - events[i].at < FOLD_MS; i--) {
    if (events[i].kind === kind && ++n >= FLOOD_ENTRIES) return true;
  }
  return false;
}

// Record one event. Repeated failures from the same source fold into the
// previous entry (and, during a flood, from any source, counting the
// addresses); a successful sign-in notes whether its address is new.
export async function recordSecurityEvent(
  kind: SecurityEventKind,
  meta: EventMeta,
  detail?: string,
  now = Date.now()
): Promise<SecurityEvent> {
  const store = await ready();
  const last = store.events[store.events.length - 1];
  if (FOLDABLE.has(kind) && last && last.kind === kind && now - last.at < FOLD_MS) {
    const same = sameSource(last.ip, meta.ip);
    if (same || flooding(store.events, kind, now)) {
      last.at = now;
      last.count = (last.count ?? 1) + 1;
      if (!same) last.addresses = (last.addresses ?? 1) + 1;
      await persist(store);
      return last;
    }
  }
  const event: SecurityEvent = { at: now, kind, ip: meta.ip, userAgent: meta.userAgent };
  if (detail) event.detail = detail;
  if (meta.account) event.account = meta.account;
  if (kind === "signin.ok") {
    // New to this account: another account's sign-in from the same place
    // says nothing about this one's (#423).
    event.newAddress = !store.events.some(
      (e) =>
        e.kind === "signin.ok" &&
        e.ip === meta.ip &&
        eventAccount(e) === eventAccount(event) &&
        now - e.at < NEW_ADDRESS_MS
    );
  }
  store.events.push(event);
  if (store.events.length > MAX_EVENTS) store.events.splice(0, store.events.length - MAX_EVENTS);
  await persist(store);
  return event;
}

// The most recent events, newest first.
export async function listSecurityEvents(limit = 50, now = Date.now()): Promise<SecurityEvent[]> {
  const store = await ready();
  const cutoff = now - KEEP_MS;
  return store.events
    .filter((e) => e.at >= cutoff)
    .slice(-limit)
    .reverse();
}

// Whether the volume is holding the log (false after a failed write).
export async function securityLogPersisted(): Promise<boolean> {
  return !(await ready()).persistFailed;
}
