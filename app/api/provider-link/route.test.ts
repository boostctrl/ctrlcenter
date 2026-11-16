import { describe, it, expect, beforeAll } from "vitest";
import * as YAML from "js-yaml";
import { useScratchConfig, request, adminSession, memberSession, staleSession, latestAuditEntry, params } from "@/lib/testing/routes";

// Connecting an account to the sign-in provider (#555): starting it from the
// account's own page, disconnecting it, and an admin disconnecting one.
let POST: typeof import("./route").POST;
let DELETE: typeof import("./route").DELETE;
let adminUnlink: typeof import("../accounts/[id]/provider/route").DELETE;
let config: typeof import("@/lib/config");

const LINK = { iss: "https://op.test", sub: "u-sam", name: "sam", linkedAt: 1 };

beforeAll(async () => {
  await useScratchConfig(
    YAML.dump({ settings: { signIn: { oidc: { enabled: true, issuer: "https://op.test", clientId: "c", clientSecret: "s" } } } })
  );
  ({ POST, DELETE } = await import("./route"));
  ({ DELETE: adminUnlink } = await import("../accounts/[id]/provider/route"));
  config = await import("@/lib/config");
});

describe("/api/provider-link", () => {
  it("starts connecting after a recent confirmation, never with a token", async () => {
    const sam = await memberSession("sam");
    const stale = await memberSession("sam");
    await staleSession(stale);
    expect((await POST(request("/api/provider-link", { method: "POST", session: stale }))).status).toBe(403);
    const res = await POST(request("/api/provider-link", { method: "POST", session: sam }));
    expect(await res.json()).toEqual({ url: "/api/auth/oidc/start?purpose=link" });
    expect((await POST(request("/api/provider-link", { method: "POST", headers: { authorization: "Bearer cct_00000000_" + "0".repeat(40) } }))).status).toBe(401);
  });

  it("disconnects the account's own, after a recent confirmation", async () => {
    await config.setProviderLink("sam", LINK);
    const stale = await memberSession("sam");
    await staleSession(stale);
    expect((await DELETE(request("/api/provider-link", { method: "DELETE", session: stale }))).status).toBe(403);
    expect((await DELETE(request("/api/provider-link", { method: "DELETE", session: await memberSession("sam") }))).status).toBe(204);
    expect((await config.readConfigInternal()).auth.users.find((u) => u.id === "sam")?.provider).toBeNull();
    expect(await latestAuditEntry()).toMatchObject({ kind: "provider.unlinked" });
  });

  it("refuses to give one identity to two accounts", async () => {
    await config.setProviderLink("sam", LINK);
    await memberSession("kim");
    await expect(config.setProviderLink("kim", { ...LINK, name: "kim" })).rejects.toThrow(config.ProviderLinkTakenError);
  });
});

describe("an admin disconnecting an account", () => {
  it("is an admin's, after a recent confirmation", async () => {
    await config.setProviderLink("sam", LINK);
    const call = (session: string) =>
      adminUnlink(request("/api/accounts/sam/provider", { method: "DELETE", session }), params({ id: "sam" }));
    expect((await call(await memberSession("kim"))).status).toBe(401);
    const stale = await adminSession();
    await staleSession(stale);
    expect((await call(stale)).status).toBe(403);
    expect((await call(await adminSession())).status).toBe(204);
    expect((await config.readConfigInternal()).auth.users.find((u) => u.id === "sam")?.provider).toBeNull();
  });
});
