import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { persistedSessionSecret } from "./session-secret";
import { createSession, touchSession } from "./sessions";
import { arrivedForwarded, clientIp } from "./rate-limit";

export const SESSION_COOKIE_NAME = "homepage_admin_session";
// Over HTTPS the cookie carries the __Host- prefix (#369): a browser then
// refuses it from any other host, path or a Domain attribute, so a cookie
// planted by a sibling subdomain or over plain HTTP can't stand in for it.
// Plain-HTTP deployments (a LAN without TLS) keep the bare name, which the
// prefix's Secure requirement would otherwise make unusable.
export const SECURE_SESSION_COOKIE_NAME = `__Host-${SESSION_COOKIE_NAME}`;
const SESSION_DURATION = "7d";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

// Derive the JWT signing key with Web Crypto.
//
// The key never comes from a human-chosen value when it can be avoided: a
// dedicated SESSION_SECRET wins, else a random secret generated once and kept
// in the config volume (lib/session-secret.ts). Only if that volume can't hold
// it does the key fall back to ADMIN_PASSWORD, the pre-2.10 behavior.
// `extra` is mixed into the signing key so changing it invalidates every
// outstanding token. Callers pass the stored password hash, so a password change
// revokes all existing sessions whichever secret signs them.
async function getSecretKey(extra = ""): Promise<Uint8Array> {
  const base =
    process.env.SESSION_SECRET ||
    (await persistedSessionSecret()) ||
    process.env.ADMIN_PASSWORD ||
    "";
  // Fail closed: with no secret the key would derive from an empty string — a
  // publicly known value anyone could use to forge an admin session. Refuse to
  // sign or verify rather than operate with a guessable key.
  if (!base) {
    throw new Error(
      "SESSION_SECRET or ADMIN_PASSWORD must be set to sign admin sessions"
    );
  }
  // NUL separator so (base, extra) can't collide with a different split.
  const data = new TextEncoder().encode(`${base}\0${extra}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

// Mark the session cookie Secure only when the request actually arrived over
// HTTPS (directly or via a TLS-terminating proxy). Keying this off NODE_ENV
// instead would set Secure in the production container even on plain-HTTP
// deployments, where browsers silently drop the cookie on non-localhost
// origins — so the login would succeed but never stick.
export function isHttps(request: NextRequest): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0]?.trim() === "https";
  return request.nextUrl.protocol === "https:";
}

// Shared session-cookie flags so login and password-change set them identically.
export function sessionCookieOptions(request: NextRequest) {
  return {
    httpOnly: true,
    secure: isHttps(request),
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

// The cookie name for this request: the __Host- one over HTTPS, else the
// bare one.
export function sessionCookieName(request: NextRequest): string {
  return isHttps(request) ? SECURE_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME;
}

// The token a request carries, under either name (a deployment can move
// between HTTP and HTTPS; the stale one is cleared on sign-out).
export function sessionTokenFrom(cookies: {
  get: (name: string) => { value: string } | undefined;
}): string | undefined {
  return cookies.get(SECURE_SESSION_COOKIE_NAME)?.value ?? cookies.get(SESSION_COOKIE_NAME)?.value;
}

type CookieJar = {
  set: (name: string, value: string, options: ReturnType<typeof sessionCookieOptions>) => unknown;
  // Method signatures, so NextResponse's overloaded delete satisfies them.
  delete(name: string): unknown;
  delete(options: { name: string; path?: string; secure?: boolean }): unknown;
};

// Set the session cookie on a response under the name the request calls
// for, and clear it under both.
export function setSessionCookie(response: { cookies: CookieJar }, request: NextRequest, token: string): void {
  response.cookies.set(sessionCookieName(request), token, sessionCookieOptions(request));
}
export function clearSessionCookie(response: { cookies: CookieJar }): void {
  // A browser ignores a __Host- Set-Cookie without Secure, so a bare delete
  // left the dead cookie in place (#392). The session itself is revoked
  // server-side either way; this clears the browser's copy too.
  response.cookies.delete({ name: SECURE_SESSION_COOKIE_NAME, path: "/", secure: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
}

// Whether any admin credential exists: a password set through the UI (stored
// hash) or the ADMIN_PASSWORD env var. With neither, nobody can sign in, and the
// login page says so instead of answering every attempt with "Invalid
// password" (#275).
export function adminPasswordConfigured(auth: { passwordHash?: string }): boolean {
  return Boolean(auth.passwordHash) || Boolean(process.env.ADMIN_PASSWORD);
}

export const NO_PASSWORD_MESSAGE =
  "No admin password is set. Set ADMIN_PASSWORD in the container's environment and restart it.";

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

// Sign a token for an existing session record (lib/sessions.ts): the record's
// id rides in `jti`, and verification requires the record to still exist, so
// a revoked or idle-expired session's token stops working at once (#365).
export async function createSessionToken(
  extra = "",
  sessionId: string
): Promise<string> {
  const key = await getSecretKey(extra);
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(sessionId)
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(key);
}

// Start a session for this request — the record (with the client address
// and browser, for the active-sessions list) and the token for the cookie.
export async function issueSession(
  request: NextRequest,
  extra = ""
): Promise<{ token: string; id: string }> {
  const id = await createSession({
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent") ?? "",
    https: isHttps(request),
    forwarded: arrivedForwarded(request),
  });
  return { token: await createSessionToken(extra, id), id };
}

// The id of the live session a token names, or null: a bad signature, an
// expired token, a token without a session id (issued before 3.0.0 — those
// sign in again once), or a session that was revoked or idled out. A live
// session is marked seen.
export async function verifySessionId(
  token: string | undefined,
  extra = ""
): Promise<string | null> {
  if (!token) return null;
  let jti: string | undefined;
  try {
    const key = await getSecretKey(extra);
    jti = (await jwtVerify(token, key)).payload.jti;
  } catch {
    return null;
  }
  if (!jti) return null;
  return (await touchSession(jti)) ? jti : null;
}

export async function verifySessionToken(
  token: string | undefined,
  extra = ""
): Promise<boolean> {
  return (await verifySessionId(token, extra)) !== null;
}
