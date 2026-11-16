import { describe, it, expect, beforeAll, vi } from "vitest";
import * as YAML from "js-yaml";
import { useScratchConfig, request, adminSession, memberSession, staleSession, latestAuditEntry } from "@/lib/testing/routes";

// Personal API tokens (#538): making and revoking them, and what one can
// and can't reach.
let POST: typeof import("./route").POST;
let GET: typeof import("./route").GET;
let DELETE: typeof import("./[id]/route").DELETE;
let apps: typeof import("../apps/route").GET;
let status: typeof import("../status/route").GET;
let settings: typeof import("../settings/route").GET;
let reauth: typeof import("@/lib/reauth");
let config: typeof import("@/lib/config");
let admin: string;
let sam: string;

beforeAll(async () => {
  await useScratchConfig(
    YAML.dump({
      apps: [
        { id: "open", name: "Open", url: "https://open.test" },
        { id: "fam", name: "Family", url: "https://fam.test", private: true, audience: { groups: ["family"] } },
        { id: "mine", name: "Admin only", url: "https://admin.test", private: true },
      ],
    })
  );
  vi.stubEnv("ADMIN_PASSWORD", "correct horse battery");
  ({ POST, GET } = await import("./route"));
  ({ DELETE } = await import("./[id]/route"));
  ({ GET: apps } = await import("../apps/route"));
  ({ GET: status } = await import("../status/route"));
  ({ GET: settings } = await import("../settings/route"));
  reauth = await import("@/lib/reauth");
  config = await import("@/lib/config");
  admin = await adminSession();
  sam = await memberSession("sam", ["family"]);
});

const make = (body: unknown, session: string) => POST(request("/api/tokens", { method: "POST", body, session }));
const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe("making and revoking tokens", () => {
  it("makes one after a recent confirmation, shows it once, and records it", async () => {
    const stale = await adminSession();
    await staleSession(stale);
    expect((await make({ name: "HA" }, stale)).status).toBe(403);
    const res = await make({ name: "HA", scope: "actions", expiresInDays: null }, admin);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toMatch(/^cct_/);
    expect(body.record).toMatchObject({ name: "HA", scope: "actions", expiresAt: null });
    expect(await latestAuditEntry()).toMatchObject({ kind: "token.created", detail: "HA" });
    const listed = await (await GET(request("/api/tokens", { session: admin }))).json();
    expect(JSON.stringify(listed)).not.toContain(body.token);
  });

  it("lets a member make a read token, not an acting one", async () => {
    expect((await make({ name: "x", scope: "actions" }, sam)).status).toBe(403);
    expect((await make({ name: "phone" }, sam)).status).toBe(201);
    const own = (await (await GET(request("/api/tokens", { session: sam }))).json()).tokens;
    expect(own.map((t: { account: string }) => t.account)).toEqual(["sam"]);
    // Only an admin sees every account's.
    expect((await GET(request("/api/tokens?all=1", { session: sam }))).status).toBe(401);
    const every = (await (await GET(request("/api/tokens?all=1", { session: admin }))).json()).tokens;
    expect(new Set(every.map((t: { account: string }) => t.account))).toEqual(new Set(["admin", "sam"]));
  });

  it("revokes a member's own, and lets an admin revoke anyone's, but not a member someone else's", async () => {
    const mine = (await (await make({ name: "mine" }, admin)).json()).record.id;
    expect((await DELETE(request(`/api/tokens/${mine}`, { method: "DELETE", session: sam }), { params: Promise.resolve({ id: mine }) })).status).toBe(404);
    const theirs = (await (await make({ name: "theirs" }, sam)).json()).record.id;
    expect((await DELETE(request(`/api/tokens/${theirs}`, { method: "DELETE", session: admin }), { params: Promise.resolve({ id: theirs }) })).status).toBe(204);
    expect(await latestAuditEntry()).toMatchObject({ kind: "token.revoked", detail: "theirs (sam)" });
  });

  it("can't make or list tokens with a token", async () => {
    const { token } = await (await make({ name: "t" }, admin)).json();
    expect((await GET(request("/api/tokens", bearer(token)))).status).toBe(401);
  });
});

describe("using a token", () => {
  it("reads as its account: an admin's sees every app, a member's what is shared with it", async () => {
    const adminToken = (await (await make({ name: "a" }, admin)).json()).token;
    expect((await apps(request("/api/apps", bearer(adminToken)))).status).toBe(200);
    const samToken = (await (await make({ name: "s" }, sam)).json()).token;
    // The full app list is the admin's; the status APIs see what the
    // account sees, through the same accessor.
    expect((await apps(request("/api/apps", bearer(samToken)))).status).toBe(401);
    const { readPublicConfig } = await import("@/lib/api-auth");
    const seen = await readPublicConfig(request("/api/status", bearer(samToken)));
    expect(seen.viewer?.token).toMatchObject({ scope: "read" });
    expect(seen.config.apps.map((a) => a.id)).toEqual(["open", "fam"]);
    // On a route tokens may not use, the same token is no one.
    expect((await readPublicConfig(request("/api/settings", bearer(samToken)))).config.apps.map((a) => a.id)).toEqual(["open"]);
  });

  it("never reaches the settings, and a wrong or revoked token is no one", async () => {
    const { token, record } = await (await make({ name: "x" }, admin)).json();
    expect((await settings(request("/api/settings", bearer(token)))).status).toBe(401);
    // One character off: changed to something it isn't, whatever it was.
    const wrong = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect((await apps(request("/api/apps", bearer(wrong)))).status).toBe(401);
    await DELETE(request(`/api/tokens/${record.id}`, { method: "DELETE", session: admin }), { params: Promise.resolve({ id: record.id }) });
    expect((await apps(request("/api/apps", bearer(token)))).status).toBe(401);
  });

  it("stops working while its account is disabled", async () => {
    const { token } = await (await make({ name: "y" }, sam)).json();
    const { readPublicConfig } = await import("@/lib/api-auth");
    await config.updateAccount("sam", { enabled: false });
    expect((await readPublicConfig(request("/api/status", bearer(token)))).viewer).toBeNull();
    await config.updateAccount("sam", { enabled: true });
    expect((await readPublicConfig(request("/api/status", bearer(token)))).viewer?.account.id).toBe("sam");
    expect((await status(request("/api/status", bearer(token)))).status).toBe(200);
  });

  it("stands in for the step-up on an action with the actions scope, and nowhere else", async () => {
    const acting = (await (await make({ name: "act", scope: "actions" }, admin)).json()).token;
    const reading = (await (await make({ name: "read" }, admin)).json()).token;
    const action = (token: string) =>
      request("/api/monitor/action", { method: "POST", body: {}, headers: { authorization: `Bearer ${token}` } });
    expect((await reauth.requireRecentAuth(action(acting))).ok).toBe(true);
    expect((await reauth.requireRecentAuth(action(reading))).ok).toBe(false);
  });
});
