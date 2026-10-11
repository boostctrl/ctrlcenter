import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { adminSession, request, useScratchConfig } from "@/lib/testing/routes";
import { REAUTH_WINDOW_MS } from "@/lib/reauth";

// Step-up re-authentication (#366): the confirmation route, and a guarded
// route (the password change) seen through it — fresh sign-in passes, a
// stale session gets the 403 the UI acts on, a confirmation lets it through.
let REAUTH: typeof import("./route").POST;
let PASSWORD: typeof import("../password/route").POST;
let EXPORT: typeof import("../config/route").GET;
let ip = 0;

beforeAll(async () => {
  await useScratchConfig();
  ({ POST: REAUTH } = await import("./route"));
  ({ POST: PASSWORD } = await import("../password/route"));
  ({ GET: EXPORT } = await import("../config/route"));
});

beforeEach(() => {
  ip += 1;
  vi.stubEnv("ADMIN_PASSWORD", "correct horse");
});

// Each test confirms from its own address: the throttle is module state.
const reauth = (session: string | undefined, body: unknown) =>
  REAUTH(
    request("/api/reauth", {
      method: "POST",
      body,
      session,
      headers: { "x-forwarded-for": `10.9.0.${ip}` },
    })
  );
const changePassword = (session: string) =>
  PASSWORD(
    request("/api/password", {
      method: "POST",
      body: { current: "correct horse", next: "correct horse battery" },
      session,
    })
  );

// Age a session's last confirmation past the window.
async function stale(session: string) {
  const { verifySessionId } = await import("@/lib/auth");
  const { markReauth } = await import("@/lib/sessions");
  const id = await verifySessionId(session);
  if (!id) throw new Error("no session");
  await markReauth(id, Date.now() - REAUTH_WINDOW_MS - 1);
}

describe("POST /api/reauth", () => {
  it("needs a session", async () => {
    expect((await reauth(undefined, { password: "correct horse" })).status).toBe(401);
  });

  it("rejects a wrong password and accepts the right one", async () => {
    const session = await adminSession();
    expect((await reauth(session, { password: "nope" })).status).toBe(401);
    const ok = await reauth(session, { password: "correct horse" });
    expect(ok.status).toBe(200);
  });

  it("throttles a client after five wrong attempts", async () => {
    const session = await adminSession();
    for (let i = 0; i < 5; i++) expect((await reauth(session, { password: "nope" })).status).toBe(401);
    expect((await reauth(session, { password: "correct horse" })).status).toBe(429);
  });
});

describe("requireRecentAuth (#366)", () => {
  it("lets a fresh sign-in through: signing in is a confirmation", async () => {
    const session = await adminSession();
    const res = await EXPORT(request("/api/config?secrets=1", { session }));
    expect(res.status).toBe(200);
  });

  it("answers a stale session with 403 and reauthRequired, then passes after a confirmation", async () => {
    const session = await adminSession();
    await stale(session);
    const refused = await EXPORT(request("/api/config?secrets=1", { session }));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ reauthRequired: true });
    // The secret-less export never needs it.
    expect((await EXPORT(request("/api/config", { session }))).status).toBe(200);

    expect((await reauth(session, { password: "correct horse" })).status).toBe(200);
    expect((await EXPORT(request("/api/config?secrets=1", { session }))).status).toBe(200);
  });

  it("guards the password change the same way", async () => {
    const session = await adminSession();
    await stale(session);
    expect((await changePassword(session)).status).toBe(403);
    expect((await reauth(session, { password: "correct horse" })).status).toBe(200);
    const res = await changePassword(session);
    expect(res.status).toBe(200);
    // Put the env password back for the tests after this one: a stored hash
    // now wins, so clear it.
    const { setPasswordHash } = await import("@/lib/config");
    await setPasswordHash("", "");
  });

  it("asks for the code too once the second factor is on", async () => {
    const session = await adminSession();
    const { activateTotp, disableTotp } = await import("@/lib/config");
    await activateTotp("JBSWY3DPEHPK3PXP", []);
    try {
      const noCode = await reauth(session, { password: "correct horse" });
      expect(noCode.status).toBe(401);
      expect(await noCode.json()).toMatchObject({ totpRequired: true });
      const { totpCode } = await import("@/lib/totp");
      const ok = await reauth(session, { password: "correct horse", totp: await totpCode("JBSWY3DPEHPK3PXP") });
      expect(ok.status).toBe(200);
    } finally {
      await disableTotp();
    }
  });
});
