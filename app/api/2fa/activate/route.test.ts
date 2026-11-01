import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { adminSession, request, useScratchConfig } from "@/lib/testing/routes";
import { totpCode } from "@/lib/totp";
import { FOUNDING_ACCOUNT_ID } from "@/lib/schema";

// Confirming a pending TOTP secret (#198), and never over an active factor
// (#384).
let route: typeof import("./route");
let session: string;

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  route = await import("./route");
  session = await adminSession();
});

afterEach(async () => {
  const { disableTotp } = await import("@/lib/config");
  await disableTotp(FOUNDING_ACCOUNT_ID);
});

const LIVE = "JBSWY3DPEHPK3PXP";
const PENDING = "KRSXG5CTMVRXEZLU";
const activate = async (secret: string) =>
  route.POST(
    request("/api/2fa/activate", { method: "POST", session, body: { code: await totpCode(secret) } })
  );

describe("POST /api/2fa/activate", () => {
  it("turns a pending secret on with a matching code, with ten recovery codes", async () => {
    const { setTotpPendingSecret, readConfigInternal } = await import("@/lib/config");
    await setTotpPendingSecret(FOUNDING_ACCOUNT_ID, PENDING);
    const res = await activate(PENDING);
    expect(res.status).toBe(200);
    expect((await res.json()).recoveryCodes).toHaveLength(10);
    expect((await readConfigInternal()).auth.totp).toMatchObject({
      enabled: true,
      secret: PENDING,
      pendingSecret: "",
    });
  });

  it("refuses with 409 while it's on, even beside a pending secret (#384)", async () => {
    const { activateTotp, setTotpPendingSecret, readConfigInternal } = await import("@/lib/config");
    const codes = [{ hash: "h1", salt: "s1" }];
    await activateTotp(FOUNDING_ACCOUNT_ID, LIVE, codes);
    // What an older version's setup left behind when run over the factor.
    await setTotpPendingSecret(FOUNDING_ACCOUNT_ID, PENDING);
    const res = await activate(PENDING);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already on/);
    expect((await readConfigInternal()).auth.totp).toMatchObject({
      enabled: true,
      secret: LIVE,
      recoveryCodes: codes,
    });
  });
});

describe("confirmTotpEnrollment checks inside the write queue (#399)", () => {
  it("refuses once the factor is on, and when the enrollment the code was checked against is gone", async () => {
    const { confirmTotpEnrollment, setTotpPendingSecret, TotpStateError } = await import("@/lib/config");
    const codes = [{ hash: "h1", salt: "s1" }];
    await setTotpPendingSecret(FOUNDING_ACCOUNT_ID, PENDING);
    await confirmTotpEnrollment(FOUNDING_ACCOUNT_ID, PENDING, codes);
    // A second activation that passed its checks before the first landed.
    await expect(confirmTotpEnrollment(FOUNDING_ACCOUNT_ID, PENDING, codes)).rejects.toMatchObject({ status: 409 });
    const { disableTotp } = await import("@/lib/config");
    await disableTotp(FOUNDING_ACCOUNT_ID);
    await setTotpPendingSecret(FOUNDING_ACCOUNT_ID, LIVE);
    const stale = confirmTotpEnrollment(FOUNDING_ACCOUNT_ID, PENDING, codes);
    await expect(stale).rejects.toBeInstanceOf(TotpStateError);
    await expect(stale).rejects.toMatchObject({ status: 400 });
  });
});
