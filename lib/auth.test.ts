import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  adminPasswordConfigured,
  verifyEnvPassword,
  hashPassword,
  verifyPasswordHash,
  createSessionToken,
  verifySessionId,
  verifySessionToken,
  verifySession,
  sessionCookieName,
  sessionTokenFrom,
  SESSION_COOKIE_NAME,
  SECURE_SESSION_COOKIE_NAME,
  clearSessionCookie,
} from "./auth";
import { NextRequest, NextResponse } from "next/server";
import { createSession, revokeSession, revokeSessions } from "./sessions";
import { SignJWT } from "jose";
import { authSchema, FOUNDING_ACCOUNT_ID, userSchema } from "./schema/auth";

// The founding admin on ADMIN_PASSWORD (no stored hash), and with one.
const AUTH = authSchema.parse({});
const authWith = (passwordHash: string) => authSchema.parse({ passwordHash });
const ADMIN = { id: FOUNDING_ACCOUNT_ID, passwordHash: "" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyEnvPassword", () => {
  it("accepts the configured password", () => {
    vi.stubEnv("ADMIN_PASSWORD", "s3cret");
    expect(verifyEnvPassword("s3cret")).toBe(true);
  });

  it("rejects a wrong password", () => {
    vi.stubEnv("ADMIN_PASSWORD", "s3cret");
    expect(verifyEnvPassword("nope")).toBe(false);
  });

  it("rejects a password of a different length", () => {
    vi.stubEnv("ADMIN_PASSWORD", "s3cret");
    expect(verifyEnvPassword("s3cre")).toBe(false);
  });

  it("rejects everything when no password is configured", () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(verifyEnvPassword("")).toBe(false);
    expect(verifyEnvPassword("anything")).toBe(false);
  });
});

describe("adminPasswordConfigured (#275)", () => {
  it("is false with no stored hash and no ADMIN_PASSWORD", () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(adminPasswordConfigured({})).toBe(false);
  });

  it("is true with ADMIN_PASSWORD set", () => {
    vi.stubEnv("ADMIN_PASSWORD", "s3cret");
    expect(adminPasswordConfigured({})).toBe(true);
  });

  it("is true with a password set through the UI, even without the env var", () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(adminPasswordConfigured({ passwordHash: "abc" })).toBe(true);
  });
});

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const { hash, salt } = await hashPassword("correct horse");
    expect(await verifyPasswordHash("correct horse", hash, salt)).toBe(true);
    expect(await verifyPasswordHash("wrong horse", hash, salt)).toBe(false);
  });

  it("uses a random salt so identical passwords hash differently", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    // Both still verify against their own salt.
    expect(await verifyPasswordHash("same", a.hash, a.salt)).toBe(true);
    expect(await verifyPasswordHash("same", b.hash, b.salt)).toBe(true);
  });

  it("returns false for empty hash or salt", async () => {
    expect(await verifyPasswordHash("x", "", "")).toBe(false);
  });
});

// Session-token tests choose where the persisted secret lives: a fresh scratch
// volume (the normal case), or one it can't be written to, which falls back to
// ADMIN_PASSWORD like deployments did before the secret was persisted.
function useVolume(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrl-auth-"));
  vi.stubEnv("CONFIG_PATH", path.join(dir, "config.yaml"));
  return dir;
}
function noVolume() {
  vi.stubEnv("CONFIG_PATH", "/dev/null/config.yaml");
}

// A token for a fresh session record (#365): tokens only verify while their
// record exists, so every signed token here starts one.
const meta = { ip: "203.0.113.9", userAgent: "test" };
async function signedToken(extra = ""): Promise<string> {
  return createSessionToken({ id: FOUNDING_ACCOUNT_ID, passwordHash: extra }, await createSession(meta));
}

describe("session tokens", () => {
  it("round-trips a token signed and verified with the same secret", async () => {
    useVolume();
    const token = await signedToken();
    expect(await verifySessionToken(token, AUTH)).toBe(true);
  });

  it("names the session the token belongs to", async () => {
    useVolume();
    const id = await createSession(meta);
    const token = await createSessionToken(ADMIN, id);
    expect(await verifySessionId(token, AUTH)).toBe(id);
    expect(await verifySessionId("not-a-jwt", AUTH)).toBeNull();
  });

  it("stops verifying once the session is revoked (#365)", async () => {
    useVolume();
    const id = await createSession(meta);
    const token = await createSessionToken(ADMIN, id);
    expect(await verifySessionToken(token, AUTH)).toBe(true);
    await revokeSession(id);
    expect(await verifySessionToken(token, AUTH)).toBe(false);
  });

  it("stops verifying after sign-out-everywhere (#365)", async () => {
    useVolume();
    const token = await signedToken();
    await revokeSessions();
    expect(await verifySessionToken(token, AUTH)).toBe(false);
  });

  it("rejects a token without a session id, however well signed", async () => {
    useVolume();
    vi.stubEnv("SESSION_SECRET", "dedicated-secret");
    // The pre-3.0 token shape: same claims, no jti.
    const key = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dedicated-secret\0"))
    );
    const legacy = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(key);
    expect(await verifySessionToken(legacy, AUTH)).toBe(false);
    // The same key does sign a current token, so it was the missing id.
    expect(await verifySessionToken(await signedToken(), AUTH)).toBe(true);
  });

  it("rejects an undefined or garbage token", async () => {
    useVolume();
    expect(await verifySessionToken(undefined, AUTH)).toBe(false);
    expect(await verifySessionToken("not-a-jwt", AUTH)).toBe(false);
  });

  it("persists a random secret in the volume when SESSION_SECRET is unset", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("ADMIN_PASSWORD", "old-password");
    const dir = useVolume();
    const token = await signedToken();
    const secret = fs.readFileSync(path.join(dir, "session-secret"), "utf8").trim();
    expect(secret.length).toBeGreaterThanOrEqual(40);
    expect(fs.statSync(path.join(dir, "session-secret")).mode & 0o777).toBe(0o600);
    // Signing no longer depends on the admin password.
    vi.stubEnv("ADMIN_PASSWORD", "new-password");
    expect(await verifySessionToken(token, AUTH)).toBe(true);
  });

  it("falls back to ADMIN_PASSWORD when the volume can't hold the secret", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    noVolume();
    vi.stubEnv("ADMIN_PASSWORD", "old-password");
    const token = await signedToken();
    vi.stubEnv("ADMIN_PASSWORD", "new-password");
    expect(await verifySessionToken(token, AUTH)).toBe(false);
  });

  it("keeps tokens valid across password changes when SESSION_SECRET is set", async () => {
    useVolume();
    vi.stubEnv("SESSION_SECRET", "dedicated-secret");
    vi.stubEnv("ADMIN_PASSWORD", "old-password");
    const token = await signedToken();

    vi.stubEnv("ADMIN_PASSWORD", "new-password");
    expect(await verifySessionToken(token, AUTH)).toBe(true);
  });

  it("invalidates a token when the mixed-in key material (password hash) changes", async () => {
    useVolume();
    vi.stubEnv("SESSION_SECRET", "dedicated-secret");
    const token = await signedToken("password-hash-A");
    // Same material still verifies...
    expect(await verifySessionToken(token, authWith("password-hash-A"))).toBe(true);
    // ...but a changed password hash (e.g. after a password change) does not,
    // even though SESSION_SECRET is unchanged.
    expect(await verifySessionToken(token, authWith("password-hash-B"))).toBe(false);
  });

  it("fails closed when no secret is available at all", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("ADMIN_PASSWORD", "");
    noVolume();
    // Signing must refuse rather than derive a guessable empty-string key...
    await expect(createSessionToken(ADMIN, "some-session")).rejects.toThrow();
    // ...and verification of any token returns false (never accepts a forgery).
    expect(await verifySessionToken("anything", AUTH)).toBe(false);
  });

  it("prefers SESSION_SECRET over the persisted secret", async () => {
    // Sign with a SESSION_SECRET in place...
    useVolume();
    vi.stubEnv("SESSION_SECRET", "the-real-secret");
    const token = await signedToken();

    // ...then drop SESSION_SECRET so the persisted secret signs instead. The
    // key now differs, so the previously issued token must no longer verify.
    vi.stubEnv("SESSION_SECRET", "");
    expect(await verifySessionToken(token, AUTH)).toBe(false);
  });
});

describe("session cookie name (#369)", () => {
  const req = (headers: Record<string, string> = {}, url = "http://dash.lan/") =>
    new NextRequest(url, { headers });

  it("carries the __Host- prefix over HTTPS and the bare name over HTTP", () => {
    expect(sessionCookieName(req())).toBe(SESSION_COOKIE_NAME);
    expect(sessionCookieName(req({}, "https://dash.lan/"))).toBe(SECURE_SESSION_COOKIE_NAME);
    expect(sessionCookieName(req({ "x-forwarded-proto": "https" }))).toBe(SECURE_SESSION_COOKIE_NAME);
    expect(SECURE_SESSION_COOKIE_NAME.startsWith("__Host-")).toBe(true);
  });

  it("reads the token under either name, preferring the secure one", () => {
    const jar = (entries: Record<string, string>) => ({
      get: (name: string) => (name in entries ? { value: entries[name] } : undefined),
    });
    expect(sessionTokenFrom(jar({}))).toBeUndefined();
    expect(sessionTokenFrom(jar({ [SESSION_COOKIE_NAME]: "plain" }))).toBe("plain");
    expect(sessionTokenFrom(jar({ [SECURE_SESSION_COOKIE_NAME]: "secure", [SESSION_COOKIE_NAME]: "plain" }))).toBe("secure");
  });
});

describe("clearSessionCookie (#392)", () => {
  it("expires the __Host- cookie with Secure, which a browser needs to accept the change", () => {
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    const set = res.headers.getSetCookie();
    const secure = set.find((c) => c.startsWith(SECURE_SESSION_COOKIE_NAME + "="));
    expect(secure).toMatch(/; *Secure/i);
    expect(secure).toMatch(/Path=\//);
    expect(secure).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(set.find((c) => c.startsWith(SESSION_COOKIE_NAME + "="))).toBeTruthy();
  });
});

describe("session tokens per account (#423)", () => {
  const admin = userSchema.parse({ id: "admin", role: "admin", passwordHash: "admin-hash", passwordSalt: "x" });
  const sam = userSchema.parse({ id: "sam", role: "member", passwordHash: "sam-hash", passwordSalt: "x" });
  const auth = authSchema.parse({ passwordHash: "admin-hash", passwordSalt: "x", users: [admin, sam] });
  const session = (account?: string) => createSession({ ...meta, account });

  it("names its account and verifies only against that account's hash", async () => {
    useVolume();
    const id = await session("sam");
    const token = await createSessionToken(sam, id);
    const live = await verifySession(token, auth);
    expect(live?.account.id).toBe("sam");
    expect(live?.session.id).toBe(id);
    // Sam's password change revokes Sam's token; the admin's keeps working.
    const changed = authSchema.parse({ ...auth, users: [admin, { ...sam, passwordHash: "new-hash" }] });
    expect(await verifySessionToken(token, changed)).toBe(false);
    const adminToken = await createSessionToken(admin, await session("admin"));
    expect(await verifySessionToken(adminToken, changed)).toBe(true);
  });

  it("rejects a token whose account is disabled or gone, or signed over another account's session", async () => {
    useVolume();
    const token = await createSessionToken(sam, await session("sam"));
    const disabled = authSchema.parse({ ...auth, users: [admin, { ...sam, enabled: false }] });
    expect(await verifySessionToken(token, disabled)).toBe(false);
    expect(await verifySessionToken(token, authSchema.parse({ ...auth, users: [admin] }))).toBe(false);
    const crossed = await createSessionToken(sam, await session("admin"));
    expect(await verifySessionToken(crossed, auth)).toBe(false);
  });

  it("reads a 3.0 token and record, which name no account, as the founding admin's", async () => {
    useVolume();
    vi.stubEnv("SESSION_SECRET", "dedicated-secret");
    // What 3.0 signed: keyed on the stored hash, no `sub`, over a record
    // without an account.
    const id = await createSession(meta);
    const key = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dedicated-secret\0admin-hash"))
    );
    const old = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(id)
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(key);
    const live = await verifySession(old, auth);
    expect(live?.account.id).toBe("admin");
    expect(live?.session.id).toBe(id);
    // It still binds to the founding admin's hash.
    const changed = authSchema.parse({ ...auth, passwordHash: "other", users: [{ ...admin, passwordHash: "other" }, sam] });
    expect(await verifySessionToken(old, changed)).toBe(false);
  });
});
