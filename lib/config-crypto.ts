// Stored credentials encrypted at rest (#370): every password, key and token
// in config.yaml — the fields marked `credential` in the schemas (alert
// channel tokens, the SMTP password, inbound webhook tokens, a calendar's
// password) and each integration's password and API key — is written as
// `enc:v1:` + AES-256-GCM, and decrypted when the file is read, so the rest
// of the app sees the values as they were typed.
//
// The key is CONFIG_KEY from the environment when it's set, else 32 random
// bytes generated on first use into config.key beside config.yaml (owner
// only). A copy of config.yaml on its own then holds no usable credential; a
// backup of the whole volume carries the key with it, which is what moving
// an instance needs.
//
// A plaintext value (a hand edit, or a file from before this) still works
// and is encrypted on the next save; a `${NAME}` reference names a variable
// rather than holding a secret and stays as it is. A value no key opens —
// the key lost or changed — is kept exactly as stored, never blanked, so the
// right key brings it back; Settings → Security counts them.
import fs from "fs/promises";
import path from "path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto";
import { mapCredentials } from "./schema/meta";
import { settingsSchema } from "./schema/settings";
import { widgetInstanceSchema } from "./schema/instances";
import type { Config } from "./schema";
import { globalSingleton } from "./singleton";
import { log, errorReason } from "./log";

export const ENC_PREFIX = "enc:v1:";
const KEY_FILE = "config.key";
// A rotation writes the new key here first and moves it into place once the
// config is saved under it (rotateKeyFile below).
const NEW_KEY_FILE = `${KEY_FILE}.new`;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const isEnvRef = (v: string) => /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v.trim());

// Where the key file lives: beside config.yaml, resolved per call so tests
// can point CONFIG_PATH at a scratch directory. Every join is marked as a
// runtime path: left unmarked, the build matches the file name against the
// project and ships a dev checkout's config/config.key in the image.
export function keyFilePath(): string {
  const configPath =
    process.env.CONFIG_PATH ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "config", "config.yaml");
  return path.join(/* turbopackIgnore: true */ path.dirname(configPath), KEY_FILE);
}
const pendingKeyPath = (file: string) => path.join(/* turbopackIgnore: true */ path.dirname(file), NEW_KEY_FILE);

// A key from CONFIG_KEY: stretched, so a passphrase-like value is still 32
// strong bytes. The salt is fixed: the same CONFIG_KEY must give the same
// key on every start.
const fromSecret = (secret: string) => scryptSync(secret, "ctrlcenter-config-key-v1", 32);

export type KeySource = "env" | "file" | "none";
type Keys = {
  // What new values are encrypted with; null when there is none and none
  // could be made (a read-only volume), when values stay as typed.
  current: Buffer | null;
  // Every key a stored value may have been written with, current first.
  candidates: Buffer[];
  source: KeySource;
};

type KeyState = {
  // Per key-file path: the loaded keys, and the ciphertext each value had
  // when it was last read or written under the current key.
  loaded: Map<string, Promise<Keys>>;
  sealed: Map<string, Map<string, string>>;
};
const state = globalSingleton<KeyState>("__ctrlcenterConfigKeys", () => ({ loaded: new Map(), sealed: new Map() }));

async function readKey(file: string): Promise<Buffer | null> {
  try {
    const text = (await fs.readFile(file, "utf8")).trim();
    const key = Buffer.from(text, "base64url");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

// The key file, created on first use. Null when the volume can't hold one.
async function keyFromFile(file: string): Promise<Buffer | null> {
  const existing = await readKey(file);
  if (existing) return existing;
  const fresh = randomBytes(32);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Exclusive create: two first writes racing can't each make a key.
    await fs.writeFile(file, fresh.toString("base64url") + "\n", { mode: 0o600, flag: "wx" });
    return fresh;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return readKey(file);
    log.warn(`can't create ${KEY_FILE}; stored credentials stay unencrypted: ${errorReason(e)}`);
    return null;
  }
}

// `create`: make the key file when there is none. Only a write asks (and
// the status, which a save would follow): reading the config never leaves
// a key behind, so a build that prerenders pages doesn't make one.
async function loadKeys(file: string, create: boolean): Promise<Keys> {
  const envKey = process.env.CONFIG_KEY?.trim();
  const fileKey = envKey || !create ? await readKey(file) : await keyFromFile(file);
  // A rotation that stopped before moving its new key into place.
  const pending = await readKey(pendingKeyPath(file));
  const previous = process.env.CONFIG_KEY_PREVIOUS?.trim();
  const current = envKey ? fromSecret(envKey) : fileKey;
  const candidates = [current, fileKey, pending, previous ? fromSecret(previous) : null].filter(
    (k, i, all): k is Buffer => k !== null && all.findIndex((o) => o !== null && o.equals(k)) === i
  );
  return { current, candidates, source: envKey ? "env" : current ? "file" : "none" };
}

async function keysFor(create: boolean): Promise<Keys> {
  const file = keyFilePath();
  const loaded = state.loaded.get(file);
  if (loaded) {
    const keys = await loaded;
    if (keys.current || !create) return keys;
  }
  const pending = loadKeys(file, create);
  state.loaded.set(file, pending);
  return pending;
}

// The keys to be loaded afresh: after a rotation, and in tests.
export function forgetConfigKeys(): void {
  state.loaded.clear();
  state.sealed.clear();
}

const fingerprint = (key: Buffer) => createHash("sha256").update(key).digest("base64url").slice(0, 16);
function sealedFor(key: Buffer): Map<string, string> {
  const id = fingerprint(key);
  let map = state.sealed.get(id);
  if (!map) {
    map = new Map();
    state.sealed.set(id, map);
  }
  return map;
}

export function encryptValue(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ENC_PREFIX + Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

// The plaintext and the key that opened it, or null when none does.
export function decryptValue(value: string, keys: readonly Buffer[]): { plain: string; key: Buffer } | null {
  const data = Buffer.from(value.slice(ENC_PREFIX.length), "base64url");
  if (data.length < IV_BYTES + TAG_BYTES) return null;
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(data.length - TAG_BYTES);
  const body = data.subarray(IV_BYTES, data.length - TAG_BYTES);
  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return { plain: Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"), key };
    } catch {
      // Not this key; try the next.
    }
  }
  return null;
}

// Every credential in a config through `fn`: the schema-marked fields of
// the settings and the widgets, and each integration's password and key.
function mapConfig(config: Config, fn: (v: string) => string): Config {
  return {
    ...config,
    settings: mapCredentials(settingsSchema, config.settings, fn),
    widgets: config.widgets.map((w) => mapCredentials(widgetInstanceSchema, w, fn)),
    integrations: config.integrations.map((i) => ({ ...i, password: fn(i.password), apiKey: fn(i.apiKey) })),
  };
}

const storable = (v: string) => v !== "" && !isEnvRef(v);

// The config as config.yaml holds it: every credential encrypted under the
// current key. A value unchanged since it was read keeps its ciphertext, so
// a save doesn't rewrite every credential; one already encrypted that no key
// opens is kept as it is.
export async function encryptConfig(config: Config): Promise<Config> {
  const { current } = await keysFor(true);
  if (!current) return config;
  const sealed = sealedFor(current);
  return mapConfig(config, (v) => {
    if (!storable(v) || v.startsWith(ENC_PREFIX)) return v;
    let out = sealed.get(v);
    if (!out) {
      out = encryptValue(v, current);
      sealed.set(v, out);
    }
    return out;
  });
}

// The config as the app uses it: every credential decrypted. A value opened
// with the current key is remembered with its ciphertext (see above); one
// opened with an older key is re-encrypted under the current one on the
// next save.
export async function decryptConfig(config: Config): Promise<Config> {
  const { current, candidates } = await keysFor(false);
  return mapConfig(config, (v) => {
    if (!v.startsWith(ENC_PREFIX)) return v;
    const opened = decryptValue(v, candidates);
    if (!opened) return v;
    if (current && opened.key.equals(current)) sealedFor(current).set(opened.plain, v);
    return opened.plain;
  });
}

// What config.yaml holds, for Settings → Security: where the key comes
// from, and how many credentials are encrypted, still plaintext (encrypted
// on the next save), or encrypted under a key that isn't here.
export type CredentialStatus = { source: KeySource; encrypted: number; plaintext: number; unreadable: number };
export async function credentialStatus(onDisk: Config): Promise<CredentialStatus> {
  const { source, candidates } = await keysFor(true);
  const status: CredentialStatus = { source, encrypted: 0, plaintext: 0, unreadable: 0 };
  mapConfig(onDisk, (v) => {
    if (!storable(v)) return v;
    if (!v.startsWith(ENC_PREFIX)) status.plaintext++;
    else if (decryptValue(v, candidates)) status.encrypted++;
    else status.unreadable++;
    return v;
  });
  return status;
}

// A rotation (#370), in three steps around the caller's save:
// beginKeyRotation writes a fresh key beside the old one and makes it the
// current key; the caller saves the config under it; finishKeyRotation moves
// it into place. A crash between them leaves both keys readable (loadKeys
// tries the pending one), so nothing is lost.
export async function beginKeyRotation(): Promise<void> {
  if (process.env.CONFIG_KEY?.trim()) throw new Error("The key comes from CONFIG_KEY");
  const file = keyFilePath();
  const next = pendingKeyPath(file);
  const fresh = randomBytes(32);
  await fs.writeFile(next, fresh.toString("base64url") + "\n", { mode: 0o600 });
  const old = await readKey(file);
  state.loaded.set(file, Promise.resolve({ current: fresh, candidates: [fresh, ...(old ? [old] : [])], source: "file" }));
}
export async function finishKeyRotation(): Promise<void> {
  const file = keyFilePath();
  await fs.rename(pendingKeyPath(file), file);
  forgetConfigKeys();
}
