import { describe, it, expect, beforeAll, vi } from "vitest";
import { adminSession, memberSession, request, useScratchConfig } from "@/lib/testing/routes";
import { totpCode } from "@/lib/totp";

// An admin can require a second factor of an account (#449). Until it has
// one, the account reaches its own page and the calls that page makes, and
// nothing else; once it has one, it can't turn it off itself, though an
// admin still can for a lost device.
let proxy: typeof import("@/proxy").proxy;
let viewerOf: typeof import("@/lib/api-auth").viewerOf;
let POST: typeof import("./route").POST;
let PATCH: typeof import("./[id]/route").PATCH;
let dropTotp: typeof import("./[id]/totp/route").DELETE;
let login: typeof import("../login/route").POST;
let disable: typeof import("../2fa/disable/route").POST;
let admin: string;

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "correct horse battery");
  ({ proxy } = await import("@/proxy"));
  ({ viewerOf } = await import("@/lib/api-auth"));
  ({ POST } = await import("./route"));
  ({ PATCH } = await import("./[id]/route"));
  ({ DELETE: dropTotp } = await import("./[id]/totp/route"));
  ({ POST: login } = await import("../login/route"));
  ({ POST: disable } = await import("../2fa/disable/route"));
  admin = await adminSession();
});

const SECRET = "KRSXG5CTMVRXEZLU";
const require2fa = (id: string, on = true) =>
  PATCH(request(`/api/accounts/${id}`, { method: "PATCH", session: admin, body: { requireTwoFactor: on } }), {
    params: Promise.resolve({ id }),
  });

describe("requiring two-factor of an account (#449)", () => {
  it("holds the account to its own page until it has a second factor", async () => {
    const rae = await memberSession("rae");
    const res = await require2fa("rae");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ requireTwoFactor: true, totp: false });

    // Any other page sends it to its account page; that page, and signing
    // in again, still open.
    const page = await proxy(request("/b/home", { session: rae }));
    expect(page.status).toBe(307);
    expect(new URL(page.headers.get("location")!).pathname).toBe("/account");
    expect((await proxy(request("/account", { session: rae }))).status).toBe(200);
    expect((await proxy(request("/login", { session: rae }))).status).toBe(200);
    // An admin API refuses it; the ones its page calls let it through.
    expect((await proxy(request("/api/apps", { session: rae }))).status).toBe(403);
    expect((await proxy(request("/api/2fa/setup", { session: rae }))).status).toBe(200);
    expect((await proxy(request("/api/sessions", { session: rae }))).status).toBe(200);
    // The routes judge it a visitor everywhere else.
    expect(await viewerOf(request("/api/status", { session: rae }))).toBeNull();
    expect((await viewerOf(request("/api/sessions", { session: rae })))?.account.id).toBe("rae");
    // A visitor's request is untouched.
    expect((await proxy(request("/b/home"))).status).toBe(200);

    // Set up, it goes where it likes.
    const { activateTotp } = await import("@/lib/config");
    await activateTotp("rae", SECRET, []);
    expect((await proxy(request("/b/home", { session: rae }))).status).toBe(200);
    expect((await viewerOf(request("/api/status", { session: rae })))?.account.id).toBe("rae");
  });

  it("sends the sign-in to the account page, and keeps a required factor on", async () => {
    const created = await POST(
      request("/api/accounts", {
        method: "POST",
        session: admin,
        body: { id: "lee", role: "member", password: "lee-secret-12345", mustChangePassword: false, requireTwoFactor: true },
      })
    );
    expect(created.status).toBe(201);
    const signedIn = await login(
      request("/api/login", {
        method: "POST",
        body: { username: "lee", password: "lee-secret-12345" },
        headers: { "x-forwarded-for": "10.9.1.1" },
      })
    );
    expect(await signedIn.json()).toEqual({ ok: true, mustChangePassword: false, mustSetUpTwoFactor: true });

    const { activateTotp, readConfigInternal } = await import("@/lib/config");
    const { findAccount, mustSetUpTwoFactor } = await import("@/lib/accounts");
    await activateTotp("lee", SECRET, []);
    const lee = await memberSession("lee");
    const refused = await disable(
      request("/api/2fa/disable", { method: "POST", session: lee, body: { code: await totpCode(SECRET) } })
    );
    expect(refused.status).toBe(403);
    expect(findAccount((await readConfigInternal()).auth, "lee")?.totp.enabled).toBe(true);

    // An admin turns it off for a lost device; the account is held again
    // until it sets one up anew.
    const dropped = await dropTotp(request("/api/accounts/lee/totp", { method: "DELETE", session: admin }), {
      params: Promise.resolve({ id: "lee" }),
    });
    expect(dropped.ok).toBe(true);
    expect(mustSetUpTwoFactor(findAccount((await readConfigInternal()).auth, "lee")!)).toBe(true);

    // Lifting the requirement frees it.
    await require2fa("lee", false);
    expect(mustSetUpTwoFactor(findAccount((await readConfigInternal()).auth, "lee")!)).toBe(false);
  });
});
