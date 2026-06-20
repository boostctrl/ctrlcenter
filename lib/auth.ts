import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "homepage_admin_session";
const SESSION_DURATION = "7d";

// Derive the JWT signing key with Web Crypto rather than Node's `crypto`
// module so this code stays runtime-agnostic — it works unchanged from the
// Node server, the proxy, or an Edge deployment.
//
// Prefer a dedicated SESSION_SECRET so session signing isn't coupled to the
// (human-chosen, possibly weak) admin password. Fall back to deriving the key
// from ADMIN_PASSWORD for backward compatibility with existing deployments —
// in that mode, changing the password also invalidates outstanding sessions.
async function getSecretKey(): Promise<Uint8Array> {
  const base = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
  // Fail closed: with no secret the key would derive from an empty string — a
  // publicly known value anyone could use to forge an admin session. Refuse to
  // sign or verify rather than operate with a guessable key.
  if (!base) {
    throw new Error(
      "SESSION_SECRET or ADMIN_PASSWORD must be set to sign admin sessions"
    );
  }
  const data = new TextEncoder().encode(base);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

// Verify against the ADMIN_PASSWORD env var (the bootstrap / fallback credential
// when no password has been set through the UI).
export function verifyEnvPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected || typeof password !== "string") return false;
  const a = new TextEncoder().encode(password);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// --- Stored password hashing (PBKDF2 via Web Crypto, no native deps) ---
const PBKDF2_ITERATIONS = 210000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function pbkdf2(password: string, salt: BufferSource): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    KEY_BYTES * 8
  );
  return toHex(new Uint8Array(bits));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hashPassword(
  password: string
): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt);
  return { hash, salt: toHex(salt) };
}

export async function verifyPasswordHash(
  password: string,
  hash: string,
  salt: string
): Promise<boolean> {
  if (!hash || !salt || typeof password !== "string") return false;
  try {
    return timingSafeEqual(await pbkdf2(password, fromHex(salt)), hash);
  } catch {
    return false;
  }
}

export async function createSessionToken(): Promise<string> {
  const key = await getSecretKey();
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(key);
}

export async function verifySessionToken(
  token: string | undefined
): Promise<boolean> {
  if (!token) return false;
  try {
    const key = await getSecretKey();
    await jwtVerify(token, key);
    return true;
  } catch {
    return false;
  }
}
