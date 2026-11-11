import { describe, it, expect, beforeAll, vi } from "vitest";
import { adminSession, memberSession, request, useScratchConfig } from "@/lib/testing/routes";
import { totpCode } from "@/lib/totp";
import { FOUNDING_ACCOUNT_ID, integrationSchema } from "@/lib/schema";

// Turning a second factor off (#198), for the caller's own account (#423).
// Write actions follow the founding admin's factor, the one the action gate
// reads, and no one else's (#455).
let route: typeof import("./route");

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  route = await import("./route");
});

const disable = async (session: string, secret: string) =>
  route.POST(
    request("/api/2fa/disable", { method: "POST", session, body: { code: await totpCode(secret) } })
  );

async function actionsOn(): Promise<boolean[]> {
  const { readConfigInternal } = await import("@/lib/config");
  return (await readConfigInternal()).integrations.map((i) => i.allowActions);
}

describe("POST /api/2fa/disable", () => {
  it("leaves write actions on when a member turns their own second factor off (#455)", async () => {
    const { activateTotp, replaceIntegrations, readConfigInternal } = await import("@/lib/config");
    const { findAccount } = await import("@/lib/accounts");
    const member = await memberSession("sam");
    await activateTotp(FOUNDING_ACCOUNT_ID, "JBSWY3DPEHPK3PXP", []);
    await activateTotp("sam", "KRSXG5CTMVRXEZLU", []);
    await replaceIntegrations([
      integrationSchema.parse({ id: "qb", type: "qbittorrent", url: "http://q", allowActions: true }),
    ]);

    const res = await disable(member, "KRSXG5CTMVRXEZLU");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, actionsDisabled: 0 });
    const auth = (await readConfigInternal()).auth;
    expect(findAccount(auth, "sam")?.totp.enabled).toBe(false);
    expect(auth.totp.enabled).toBe(true);
    expect(await actionsOn()).toEqual([true]);
  });

  it("turns write actions off when the founding admin's second factor goes off", async () => {
    const { activateTotp, replaceIntegrations, readConfigInternal } = await import("@/lib/config");
    const admin = await adminSession();
    await activateTotp(FOUNDING_ACCOUNT_ID, "GEZDGNBVGY3TQOJQ", []);
    await replaceIntegrations([
      integrationSchema.parse({ id: "qb", type: "qbittorrent", url: "http://q", allowActions: true }),
    ]);
    const res = await disable(admin, "GEZDGNBVGY3TQOJQ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, actionsDisabled: 1 });
    expect((await readConfigInternal()).auth.totp.enabled).toBe(false);
    expect(await actionsOn()).toEqual([false]);
  });
});
