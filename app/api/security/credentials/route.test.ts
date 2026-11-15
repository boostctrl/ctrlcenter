import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import * as YAML from "js-yaml";
import { useScratchConfig, request, adminSession, memberSession, staleSession, latestAuditEntry } from "@/lib/testing/routes";

// The stored credentials at rest (#370): their status, encrypting the
// plaintext ones now, and replacing the key.
let GET: typeof import("./route").GET;
let POST: typeof import("./route").POST;
let crypto: typeof import("@/lib/config-crypto");
let configPath: string;
let admin: string;

beforeAll(async () => {
  configPath = await useScratchConfig(
    YAML.dump({ integrations: [{ id: "qb", type: "qbittorrent", url: "http://qb", username: "admin", password: "hunter2" }] })
  );
  vi.stubEnv("ADMIN_PASSWORD", "correct horse battery");
  ({ GET, POST } = await import("./route"));
  crypto = await import("@/lib/config-crypto");
  admin = await adminSession();
});
afterEach(() => vi.unstubAllEnvs());

const status = async (session = admin) => (await GET(request("/api/security/credentials", { session }))).json();
const act = (action: string, session = admin) =>
  POST(request("/api/security/credentials", { method: "POST", body: { action }, session }));
const password = async () =>
  (YAML.load(await fs.readFile(configPath, "utf8")) as { integrations: { password: string }[] }).integrations[0].password;

describe("/api/security/credentials", () => {
  it("counts a plaintext credential, and encrypts it on request", async () => {
    expect(await status()).toEqual({ source: "file", encrypted: 0, plaintext: 1, unreadable: 0 });
    const res = await act("encrypt");
    expect(await res.json()).toEqual({ source: "file", encrypted: 1, plaintext: 0, unreadable: 0 });
    expect(await password()).toMatch(/^enc:v1:/);
  });

  // Any save encrypts — adding the member account included — so this runs
  // after the plaintext count above.
  it("is for admins only", async () => {
    const member = await memberSession("sam");
    expect((await GET(request("/api/security/credentials", { session: member }))).status).toBe(401);
    expect((await act("encrypt", member)).status).toBe(401);
  });

  it("replaces the key after a recent confirmation, and records it", async () => {
    const stale = await adminSession();
    await staleSession(stale);
    expect((await act("rotate", stale)).status).toBe(403);
    const before = await password();
    const res = await act("rotate");
    expect(res.status).toBe(200);
    expect(await password()).not.toBe(before);
    expect(await latestAuditEntry()).toMatchObject({ kind: "key.rotated" });
    expect(await status()).toMatchObject({ encrypted: 1, unreadable: 0 });
  });

  it("won't replace a key from CONFIG_KEY", async () => {
    vi.stubEnv("CONFIG_KEY", "from the environment");
    crypto.forgetConfigKeys();
    const res = await act("rotate");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/CONFIG_KEY_PREVIOUS/);
    vi.unstubAllEnvs();
    crypto.forgetConfigKeys();
  });

  it("won't replace a key while a credential can't be opened, which would lose it", async () => {
    await fs.writeFile(crypto.keyFilePath(), randomBytes(32).toString("base64url"));
    crypto.forgetConfigKeys();
    expect(await status()).toMatchObject({ encrypted: 0, unreadable: 1 });
    expect((await act("rotate")).status).toBe(409);
  });
});
