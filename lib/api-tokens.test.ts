import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { useScratchConfig } from "./testing/routes";
import { tokenAllowed, tokenActionRoute, bearerOf } from "./token-routes";

// Personal API tokens (#538): the store, and where a token may be used.
let tokens: typeof import("./api-tokens");
let configPath: string;
beforeEach(async () => {
  configPath = await useScratchConfig();
  const { vi } = await import("vitest");
  vi.resetModules();
  tokens = await import("./api-tokens");
});

describe("the token store", () => {
  it("shows a token once and keeps only its hash", async () => {
    const { token, record } = await tokens.createToken("sam", " Home Assistant ", "read", 90);
    expect(token).toMatch(/^cct_[0-9a-f]{8}_[0-9a-f]{40}$/);
    expect(record).toMatchObject({ account: "sam", name: "Home Assistant", scope: "read", lastUsedAt: null });
    expect(record).not.toHaveProperty("hash");
    const file = await fs.readFile(path.join(path.dirname(configPath), "api-tokens.json"), "utf8");
    expect(file).not.toContain(token);
    expect(file).not.toContain(token.split("_")[2]);
    expect((await fs.stat(path.join(path.dirname(configPath), "api-tokens.json"))).mode & 0o777).toBe(0o600);
  });

  it("verifies the token itself, not a lookalike, and not past its expiry", async () => {
    const now = Date.now();
    const { token, record } = await tokens.createToken("sam", "t", "read", 30, now);
    expect((await tokens.verifyToken(token, now))?.id).toBe(record.id);
    const wrong = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(await tokens.verifyToken(wrong, now)).toBeNull();
    expect(await tokens.verifyToken("cct_nope", now)).toBeNull();
    expect(await tokens.verifyToken(token, now + 31 * 24 * 60 * 60 * 1000)).toBeNull();
    const forever = await tokens.createToken("sam", "f", "read", null, now);
    expect(await tokens.verifyToken(forever.token, now + 10 * 365 * 24 * 60 * 60 * 1000)).not.toBeNull();
  });

  it("lists, revokes one, and revokes an account's", async () => {
    const a = await tokens.createToken("sam", "a", "read", 30);
    await tokens.createToken("sam", "b", "read", 30);
    await tokens.createToken("kim", "c", "actions", 30);
    expect((await tokens.listTokens("sam")).map((t) => t.name).sort()).toEqual(["a", "b"]);
    expect(await tokens.listTokens()).toHaveLength(3);
    expect(await tokens.revokeToken(a.record.id)).toBe(true);
    expect(await tokens.verifyToken(a.token)).toBeNull();
    expect(await tokens.revokeAccountTokens("sam")).toBe(1);
    expect((await tokens.listTokens()).map((t) => t.account)).toEqual(["kim"]);
  });

  it("says when a token is used from a new address, once", async () => {
    const { record } = await tokens.createToken("sam", "t", "read", 30);
    expect(await tokens.touchToken(record.id, "10.0.0.5")).toBe(true);
    expect(await tokens.touchToken(record.id, "10.0.0.5")).toBe(false);
    expect(await tokens.touchToken(record.id, "10.0.0.6")).toBe(true);
    expect((await tokens.findToken(record.id))?.lastUsedAt).not.toBeNull();
  });

  it("caps an account's tokens", async () => {
    for (let i = 0; i < tokens.MAX_TOKENS_PER_ACCOUNT; i++) await tokens.createToken("sam", `t${i}`, "read", 30);
    await expect(tokens.createToken("sam", "one more", "read", 30)).rejects.toThrow(tokens.TooManyTokensError);
  });
});

describe("where a token may be used", () => {
  it("reads the status and Monitor APIs and the app and bookmark lists", () => {
    for (const p of ["/api/status", "/api/status/history", "/api/status/history/nas", "/api/status/badge/nas", "/api/monitor", "/api/monitor/qb", "/api/monitor/qb/history", "/api/apps", "/api/bookmarks"]) {
      expect(tokenAllowed("GET", p, "read")).toBe(true);
    }
  });

  it("acts only with the actions scope, and never reaches settings, accounts, tokens or backups", () => {
    expect(tokenAllowed("POST", "/api/monitor/action", "read")).toBe(false);
    expect(tokenAllowed("POST", "/api/monitor/action", "actions")).toBe(true);
    expect(tokenAllowed("GET", "/api/monitor/portainer/logs", "read")).toBe(false);
    expect(tokenAllowed("GET", "/api/monitor/portainer/logs", "actions")).toBe(true);
    for (const [m, p] of [
      ["GET", "/api/settings"], ["PUT", "/api/settings"], ["GET", "/api/accounts"], ["GET", "/api/tokens"],
      ["POST", "/api/tokens"], ["GET", "/api/config"], ["POST", "/api/config"], ["POST", "/api/monitor/test"],
      ["GET", "/api/monitor/test"], ["POST", "/api/status/history/nas/note"], ["PUT", "/api/apps"], ["GET", "/api/sign-in"],
    ] as const) {
      expect(tokenAllowed(m, p, "actions")).toBe(false);
    }
    expect(tokenActionRoute("POST", "/api/monitor/action")).toBe(true);
    expect(tokenActionRoute("GET", "/api/monitor")).toBe(false);
  });

  it("reads the token from the Authorization header", () => {
    expect(bearerOf(new Headers({ authorization: "Bearer cct_ab_cd" }))).toBe("cct_ab_cd");
    expect(bearerOf(new Headers({ authorization: "Basic xyz" }))).toBeNull();
    expect(bearerOf(new Headers())).toBeNull();
  });
});
