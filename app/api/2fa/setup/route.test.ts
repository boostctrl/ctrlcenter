import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { adminSession, request, useScratchConfig } from "@/lib/testing/routes";
import { FOUNDING_ACCOUNT_ID } from "@/lib/schema";

// TOTP enrollment (#198) starts here, and never over an active factor (#384).
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

const setup = (auth = true) =>
  route.POST(request("/api/2fa/setup", { method: "POST", session: auth ? session : undefined }));

describe("POST /api/2fa/setup", () => {
  it("requires a session", async () => {
    expect((await setup(false)).status).toBe(401);
  });

  it("mints a pending secret while two-factor authentication is off", async () => {
    const res = await setup();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(body.qr).toMatch(/^data:image\/png;base64,/);
    const { readConfigInternal } = await import("@/lib/config");
    const { totp } = (await readConfigInternal()).auth;
    expect(totp).toMatchObject({ enabled: false, pendingSecret: body.secret });
  });

  it("refuses with 409 while it's on, leaving the live secret and codes alone (#384)", async () => {
    const { activateTotp, readConfigInternal } = await import("@/lib/config");
    const codes = [{ hash: "h1", salt: "s1" }];
    await activateTotp(FOUNDING_ACCOUNT_ID, "JBSWY3DPEHPK3PXP", codes);
    const res = await setup();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already on/);
    expect((await readConfigInternal()).auth.totp).toEqual({
      enabled: true,
      secret: "JBSWY3DPEHPK3PXP",
      pendingSecret: "",
      recoveryCodes: codes,
    });
  });
});
