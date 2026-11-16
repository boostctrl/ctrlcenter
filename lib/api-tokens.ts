// Personal API tokens (#538): how a script, Home Assistant or the MCP
// endpoint (#547) reads CtrlCenter without a password or a browser. An
// account makes named tokens; each acts as its account — its role, its
// groups, what it sees — and only on the routes lib/token-routes.ts lists,
// read-only unless given the actions scope.
//
// Kept in api-tokens.json beside config.yaml, not in it: a token's last use
// changes with every call, and config.yaml is for settings. The file holds
// a hash of each token, never the token itself, which is shown once when
// made: "cct_" + an 8-character id + a 40-character secret (160 bits).
import fs from "fs/promises";
import path from "path";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { globalSingleton } from "./singleton";
import { log, errorReason } from "./log";

export type TokenScope = "read" | "actions";
export const TOKEN_SCOPES: readonly TokenScope[] = ["read", "actions"];
export const MAX_TOKENS_PER_ACCOUNT = 20;
const TOKEN_PATTERN = /^cct_([0-9a-f]{8})_([0-9a-f]{40})$/;

export type TokenRecord = {
  id: string;
  account: string;
  name: string;
  scope: TokenScope;
  // sha256 of the whole token, hex.
  hash: string;
  createdAt: number;
  // Null: never expires.
  expiresAt: number | null;
  lastUsedAt: number | null;
  // The addresses it was used from, each announced once (bounded).
  addresses?: string[];
};
// What any list shows: everything but the hash.
export type TokenView = Omit<TokenRecord, "hash" | "addresses">;

const FILE_NAME = "api-tokens.json";
const MAX_ADDRESSES = 10;
// lastUsedAt is written at most this often per token.
const TOUCH_INTERVAL_MS = 60 * 1000;

type Store = { file: string; tokens: Map<string, TokenRecord>; loaded: Promise<void> | null; writes: Promise<void> };
const stores = globalSingleton("__ctrlcenterApiTokens", () => new Map<string, Store>());

// Resolved per call so tests can point CONFIG_PATH at a scratch directory;
// every join marked as a runtime path, so the build never traces it.
function storePath(): string {
  const configPath =
    process.env.CONFIG_PATH ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "config", "config.yaml");
  return path.join(/* turbopackIgnore: true */ path.dirname(configPath), FILE_NAME);
}

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

function isRecord(v: unknown): v is TokenRecord {
  const r = v as Record<string, unknown> | null;
  return (
    !!r &&
    typeof r.id === "string" &&
    typeof r.account === "string" &&
    typeof r.name === "string" &&
    TOKEN_SCOPES.includes(r.scope as TokenScope) &&
    typeof r.hash === "string" &&
    typeof r.createdAt === "number" &&
    (r.expiresAt === null || typeof r.expiresAt === "number") &&
    (r.lastUsedAt === null || typeof r.lastUsedAt === "number")
  );
}

async function ready(): Promise<Store> {
  const file = storePath();
  let store = stores.get(file);
  if (!store) {
    store = { file, tokens: new Map(), loaded: null, writes: Promise.resolve() };
    stores.set(file, store);
  }
  const s = store;
  s.loaded ??= (async () => {
    try {
      const parsed = JSON.parse(await fs.readFile(s.file, "utf8")) as { tokens?: unknown[] };
      for (const t of parsed.tokens ?? []) if (isRecord(t)) s.tokens.set(t.id, t);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") log.warn(`API tokens file unreadable: ${errorReason(e)}`);
    }
  })();
  await s.loaded;
  return s;
}

// The whole list, atomically (temp file + rename, owner-only).
function persist(store: Store): Promise<void> {
  const snapshot = JSON.stringify({ version: 1, tokens: [...store.tokens.values()] });
  const write = store.writes.then(async () => {
    const tmp = `${store.file}.${process.pid}.tmp`;
    try {
      await fs.mkdir(path.dirname(store.file), { recursive: true });
      await fs.writeFile(tmp, snapshot, { mode: 0o600 });
      await fs.rename(tmp, store.file);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      log.warn(`can't save API tokens: ${errorReason(e)}`);
    }
  });
  store.writes = write;
  return write;
}

const view = ({ hash: _h, addresses: _a, ...rest }: TokenRecord): TokenView => {
  void _h;
  void _a;
  return rest;
};

export class TooManyTokensError extends Error {}

// A new token for `account`. The token comes back once, here; only its hash
// is kept.
export async function createToken(
  account: string,
  name: string,
  scope: TokenScope,
  expiresInDays: number | null,
  now = Date.now()
): Promise<{ token: string; record: TokenView }> {
  const store = await ready();
  if ([...store.tokens.values()].filter((t) => t.account === account).length >= MAX_TOKENS_PER_ACCOUNT) {
    throw new TooManyTokensError(`An account can have ${MAX_TOKENS_PER_ACCOUNT} tokens at most`);
  }
  let id = randomBytes(4).toString("hex");
  while (store.tokens.has(id)) id = randomBytes(4).toString("hex");
  const token = `cct_${id}_${randomBytes(20).toString("hex")}`;
  const record: TokenRecord = {
    id,
    account,
    name: name.trim().slice(0, 60),
    scope,
    hash: hashOf(token),
    createdAt: now,
    expiresAt: expiresInDays ? now + expiresInDays * 24 * 60 * 60 * 1000 : null,
    lastUsedAt: null,
  };
  store.tokens.set(id, record);
  await persist(store);
  return { token, record: view(record) };
}

// The tokens of one account, or every account's; newest first.
export async function listTokens(account?: string): Promise<TokenView[]> {
  const store = await ready();
  return [...store.tokens.values()]
    .filter((t) => account === undefined || t.account === account)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(view);
}

export async function findToken(id: string): Promise<TokenView | null> {
  const t = (await ready()).tokens.get(id);
  return t ? view(t) : null;
}

export async function revokeToken(id: string): Promise<boolean> {
  const store = await ready();
  const had = store.tokens.delete(id);
  if (had) await persist(store);
  return had;
}

// Every token of an account: when it is removed.
export async function revokeAccountTokens(account: string): Promise<number> {
  const store = await ready();
  let n = 0;
  for (const [id, t] of store.tokens) {
    if (t.account === account) {
      store.tokens.delete(id);
      n++;
    }
  }
  if (n) await persist(store);
  return n;
}

// The record a presented token names, unexpired, or null. The comparison
// is of hashes, in constant time.
export async function verifyToken(token: string, now = Date.now()): Promise<TokenRecord | null> {
  const m = TOKEN_PATTERN.exec(token);
  if (!m) return null;
  const record = (await ready()).tokens.get(m[1]);
  if (!record) return null;
  const a = Buffer.from(hashOf(token), "hex");
  const b = Buffer.from(record.hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (record.expiresAt !== null && now >= record.expiresAt) return null;
  return record;
}

// A use, recorded: when (at most once a minute), and from where. True when
// the address is one this token hasn't been used from before, which the
// caller announces.
export async function touchToken(id: string, ip: string | null, now = Date.now()): Promise<boolean> {
  const store = await ready();
  const t = store.tokens.get(id);
  if (!t) return false;
  const fresh = !!ip && !(t.addresses ?? []).includes(ip);
  if (fresh) t.addresses = [...(t.addresses ?? []), ip].slice(-MAX_ADDRESSES);
  if (fresh || t.lastUsedAt === null || now - t.lastUsedAt > TOUCH_INTERVAL_MS) {
    t.lastUsedAt = now;
    await persist(store);
  }
  return fresh;
}

// Whether a token looks like one of these, to tell a request carrying one
// from one carrying anything else.
export const looksLikeToken = (s: string) => TOKEN_PATTERN.test(s);
