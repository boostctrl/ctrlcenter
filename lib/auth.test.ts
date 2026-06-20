import { describe, it, expect, afterEach, vi } from "vitest";
import {
  verifyEnvPassword,
  hashPassword,
  verifyPasswordHash,
  createSessionToken,
  verifySessionToken,
} from "./auth";

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

describe("session tokens", () => {
  it("round-trips a token signed and verified with the same secret", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "pw");
    const token = await createSessionToken();
    expect(await verifySessionToken(token)).toBe(true);
  });

  it("rejects an undefined or garbage token", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "pw");
    expect(await verifySessionToken(undefined)).toBe(false);
    expect(await verifySessionToken("not-a-jwt")).toBe(false);
  });

  it("invalidates tokens when the password-derived key changes", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "old-password");
    const token = await createSessionToken();

    vi.stubEnv("ADMIN_PASSWORD", "new-password");
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("keeps tokens valid across password changes when SESSION_SECRET is set", async () => {
    vi.stubEnv("SESSION_SECRET", "dedicated-secret");
    vi.stubEnv("ADMIN_PASSWORD", "old-password");
    const token = await createSessionToken();

    vi.stubEnv("ADMIN_PASSWORD", "new-password");
    expect(await verifySessionToken(token)).toBe(true);
  });

  it("fails closed when no secret is configured", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("ADMIN_PASSWORD", "");
    // Signing must refuse rather than derive a guessable empty-string key...
    await expect(createSessionToken()).rejects.toThrow();
    // ...and verification of any token returns false (never accepts a forgery).
    expect(await verifySessionToken("anything")).toBe(false);
  });

  it("prefers SESSION_SECRET over ADMIN_PASSWORD for signing", async () => {
    // Sign with a SESSION_SECRET in place...
    vi.stubEnv("SESSION_SECRET", "the-real-secret");
    vi.stubEnv("ADMIN_PASSWORD", "pw");
    const token = await createSessionToken();

    // ...then drop SESSION_SECRET so only ADMIN_PASSWORD remains. The key now
    // differs, so the previously issued token must no longer verify.
    vi.stubEnv("SESSION_SECRET", "");
    expect(await verifySessionToken(token)).toBe(false);
  });
});
