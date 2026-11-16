import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import * as YAML from "js-yaml";
import { useScratchConfig, request, memberSession, latestAuditEntry, TEST_ORIGIN } from "@/lib/testing/routes";
import { mockProvider, OP, CLIENT_ID, CLIENT_SECRET } from "@/lib/testing/oidc";

// Signing in through an OpenID Connect provider (#504), end to end against a
// stand-in provider: leaving for it, coming back, the accounts and groups it
// maps onto, the second factor that may follow, and a confirmation.
let start: typeof import("./start/route").GET;
let callback: typeof import("./callback/route").GET;
let code: typeof import("./code/route").POST;
let config: typeof import("@/lib/config");
let auth: typeof import("@/lib/auth");
let oidc: typeof import("@/lib/oidc");
let provider: Awaited<ReturnType<typeof mockProvider>>;

const OIDC = { enabled: true, label: "Nextcloud", issuer: OP, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };

beforeAll(async () => {
  await useScratchConfig(YAML.dump({ settings: { signIn: { oidc: OIDC } }, auth: { groups: ["family"] } }));
  ({ GET: start } = await import("./start/route"));
  ({ GET: callback } = await import("./callback/route"));
  ({ POST: code } = await import("./code/route"));
  config = await import("@/lib/config");
  auth = await import("@/lib/auth");
  oidc = await import("@/lib/oidc");
  await memberSession("sam", ["ops"]);
});
beforeEach(async () => {
  provider = await mockProvider({ endSession: true });
  vi.stubGlobal("fetch", provider.fetch);
  oidc.forgetOidcDiscovery();
});
afterEach(() => vi.unstubAllGlobals());

// The cookies a response sets, as name → value.
const setCookies = (res: Response) =>
  Object.fromEntries(
    res.headers.getSetCookie().map((c) => {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      return [pair.slice(0, i), pair.slice(i + 1)];
    })
  );

// Leave for the provider, sign in there as `who`, come back.
async function signInAs(
  who: Parameters<typeof provider.signIn>[1],
  opts: { next?: string; purpose?: string; popup?: boolean; cookie?: string } = {}
) {
  const query = new URLSearchParams({
    ...(opts.next ? { next: opts.next } : {}),
    ...(opts.purpose ? { purpose: opts.purpose } : {}),
    ...(opts.popup ? { popup: "1" } : {}),
  });
  const away = await start(request(`/api/auth/oidc/start?${query}`, { headers: opts.cookie ? { cookie: opts.cookie } : {} }));
  expect(away.status).toBe(303);
  const flow = setCookies(away).ctrlcenter_oidc;
  const { code: c, state } = provider.signIn(away.headers.get("location") ?? "", who);
  const cookie = [`ctrlcenter_oidc=${flow}`, opts.cookie].filter(Boolean).join("; ");
  return callback(request(`/api/auth/oidc/callback?code=${c}&state=${state}`, { headers: { cookie } }));
}

const session = async (res: Response) => {
  const token = setCookies(res).homepage_admin_session;
  return token ? auth.verifySession(token, (await config.readConfigInternal()).auth) : null;
};

describe("leaving for the provider", () => {
  it("sends the browser there with PKCE, a state and a nonce, and the registered redirect address", async () => {
    const res = await start(request("/api/auth/oidc/start?next=/boards/home", { headers: { "x-forwarded-proto": "https" } }));
    const to = new URL(res.headers.get("location") ?? "");
    expect(to.origin + to.pathname).toBe(`${OP}/authorize`);
    expect(to.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(to.searchParams.get("redirect_uri")).toBe(`https://${new URL(TEST_ORIGIN).host}/api/auth/oidc/callback`);
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(to.searchParams.get("scope")).toBe("openid profile email groups");
    for (const p of ["state", "nonce", "code_challenge"]) expect(to.searchParams.get(p)).toBeTruthy();
    expect(to.searchParams.get("prompt")).toBeNull();
    expect(res.headers.getSetCookie().join()).toMatch(/ctrlcenter_oidc=.*Path=\/api\/auth\/oidc.*HttpOnly/i);
  });

  it("goes back to the form when the provider can't be reached", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    const res = await start(request("/api/auth/oidc/start"));
    expect(res.headers.get("location")).toMatch(/\/login\?error=provider$/);
  });
});

describe("coming back", () => {
  it("signs in to the account of that name, with the provider's groups that are on the list", async () => {
    const res = await signInAs({ userinfo: { preferred_username: "Sam", groups: ["family", "admins"] } }, { next: "/boards/home" });
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/boards/home");
    const live = await session(res);
    expect(live?.account.id).toBe("sam");
    // Its own group, and the provider's one that is on the list; not "admins".
    expect(live?.account.groups).toEqual(["ops", "family"]);
    expect(live?.session).toMatchObject({ via: "oidc", groups: ["family"] });
    expect(live?.session.twoFactor).toBeUndefined();
    expect(await latestAuditEntry()).toMatchObject({ kind: "signin.ok" });
    // The account's stored groups are untouched.
    expect((await config.readConfigInternal()).auth.users.find((u) => u.id === "sam")?.groups).toEqual(["ops"]);
  });

  it("refuses a name with no account, unless the admin lets the provider make one", async () => {
    const res = await signInAs({ userinfo: { preferred_username: "newbie" } });
    expect(res.headers.get("location")).toMatch(/\/login\?error=no-account&name=newbie$/);
    expect(setCookies(res).homepage_admin_session).toBeUndefined();

    await config.setSignIn({ oidc: { ...(await config.readConfigInternal()).settings.signIn.oidc, createAccounts: true } });
    const made = await signInAs({ userinfo: { preferred_username: "newbie", name: "New Bie" } });
    expect((await session(made))?.account).toMatchObject({ id: "newbie", name: "New Bie", role: "member", passwordHash: "" });
    await config.setSignIn({ oidc: { ...(await config.readConfigInternal()).settings.signIn.oidc, createAccounts: false } });
  });

  it("refuses a disabled account, a name that can't be one, and a callback without its flow", async () => {
    await config.updateAccount("sam", { enabled: false });
    expect((await signInAs({ userinfo: { preferred_username: "sam" } })).headers.get("location")).toMatch(/error=disabled/);
    await config.updateAccount("sam", { enabled: true });
    expect((await signInAs({ userinfo: { preferred_username: "Not A Name" } })).headers.get("location")).toMatch(/error=name/);
    const stray = await callback(request("/api/auth/oidc/callback?code=x&state=y"));
    expect(stray.headers.get("location")).toMatch(/error=expired/);
  });

  it("refuses a forged state", async () => {
    const away = await start(request("/api/auth/oidc/start"));
    const flow = setCookies(away).ctrlcenter_oidc;
    const { code: c } = provider.signIn(away.headers.get("location") ?? "", { userinfo: { preferred_username: "sam" } });
    const res = await callback(request(`/api/auth/oidc/callback?code=${c}&state=forged`, { headers: { cookie: `ctrlcenter_oidc=${flow}` } }));
    expect(res.headers.get("location")).toMatch(/error=provider/);
  });

  it("says when the provider turned the person away", async () => {
    const away = await start(request("/api/auth/oidc/start"));
    const flow = setCookies(away).ctrlcenter_oidc;
    const res = await callback(request("/api/auth/oidc/callback?error=access_denied&state=s", { headers: { cookie: `ctrlcenter_oidc=${flow}` } }));
    expect(res.headers.get("location")).toMatch(/error=denied/);
  });
});

describe("an account with its own second factor", () => {
  let secret: string;
  beforeAll(async () => {
    const { generateTotpSecret } = await import("@/lib/totp");
    secret = generateTotpSecret();
    await memberSession("kim");
    await config.activateTotp("kim", secret, []);
  });

  it("enters its code after the provider, when the provider didn't vouch for one", async () => {
    const res = await signInAs({ userinfo: { preferred_username: "kim" } }, { next: "/boards/home" });
    expect(res.headers.get("location")).toMatch(/\/login\?code=provider&next=%2Fboards%2Fhome$/);
    expect(setCookies(res).homepage_admin_session).toBeUndefined();
    const pending = setCookies(res).ctrlcenter_oidc_code;
    const post = (totp: string) =>
      code(request("/api/auth/oidc/code", { method: "POST", body: { totp }, headers: { cookie: `ctrlcenter_oidc_code=${pending}` } }));
    expect((await post("000000")).status).toBe(401);
    const { totpCode } = await import("@/lib/totp");
    const ok = await post(await totpCode(secret));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, next: "/boards/home", popup: false });
    expect((await session(ok))?.account.id).toBe("kim");
  });

  it("goes straight in when the provider says a second factor was used", async () => {
    const res = await signInAs({ idClaims: { amr: ["pwd", "otp"] }, userinfo: { preferred_username: "kim" } });
    expect((await session(res))?.session.twoFactor).toBe(true);
  });

  it("goes straight in when the admin says the provider requires one", async () => {
    await config.setSignIn({ oidc: { ...(await config.readConfigInternal()).settings.signIn.oidc, enforcesTwoFactor: true } });
    const res = await signInAs({ userinfo: { preferred_username: "kim" } });
    expect((await session(res))?.account.id).toBe("kim");
    await config.setSignIn({ oidc: { ...(await config.readConfigInternal()).settings.signIn.oidc, enforcesTwoFactor: false } });
  });

  it("can't use a code step it wasn't given", async () => {
    const res = await code(request("/api/auth/oidc/code", { method: "POST", body: { totp: "123456" } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ expired: true });
  });
});

describe("confirming a session at the provider", () => {
  it("asks the provider for a fresh sign-in, and confirms the session it came from", async () => {
    const token = await memberSession("sam");
    const cookie = `homepage_admin_session=${token}`;
    const away = await start(request("/api/auth/oidc/start?purpose=reauth&popup=1", { headers: { cookie } }));
    const to = new URL(away.headers.get("location") ?? "");
    expect(to.searchParams.get("prompt")).toBe("login");
    expect(to.searchParams.get("max_age")).toBe("0");

    const res = await signInAs({ userinfo: { preferred_username: "sam" } }, { purpose: "reauth", popup: true, cookie });
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain('"ok":true');
    expect(await latestAuditEntry()).toMatchObject({ kind: "reauth.ok" });
  });

  it("won't confirm a session as someone else", async () => {
    await memberSession("kim");
    const cookie = `homepage_admin_session=${await memberSession("sam")}`;
    const res = await signInAs({ userinfo: { preferred_username: "kim" } }, { purpose: "reauth", popup: true, cookie });
    expect(await res.text()).toContain('"error":"mismatch"');
  });

  it("needs a session to confirm", async () => {
    const res = await start(request("/api/auth/oidc/start?purpose=reauth"));
    expect(res.headers.get("location")).toMatch(/error=expired/);
  });
});

describe("signing out", () => {
  it("also signs out of the provider when set to, for a session that came from it", async () => {
    const { POST: logout } = await import("../../logout/route");
    const out = async (res: Response) => {
      const token = setCookies(res).homepage_admin_session;
      return (await logout(request("/api/logout", { method: "POST", headers: { cookie: `homepage_admin_session=${token}` } }))).json();
    };
    expect(await out(await signInAs({ userinfo: { preferred_username: "sam" } }))).toEqual({ ok: true });

    await config.setSignIn({ oidc: { ...(await config.readConfigInternal()).settings.signIn.oidc, endProviderSession: true } });
    const body = await out(await signInAs({ userinfo: { preferred_username: "sam" } }));
    const to = new URL(body.redirect);
    expect(to.origin + to.pathname).toBe(`${OP}/logout`);
    expect(to.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(to.searchParams.get("post_logout_redirect_uri")).toBe(`${TEST_ORIGIN}/`);
    await config.setSignIn({ oidc: { ...(await config.readConfigInternal()).settings.signIn.oidc, endProviderSession: false } });
  });
});

describe("a confirmation for a provider's session", () => {
  it("offers the provider by name, and the password only to an account that has one", async () => {
    const { requireRecentAuth } = await import("@/lib/reauth");
    const { staleSession } = await import("@/lib/testing/routes");
    const asked = async (name: string) => {
      const token = setCookies(await signInAs({ userinfo: { preferred_username: name } })).homepage_admin_session;
      await staleSession(token);
      const r = await requireRecentAuth(request("/api/x", { headers: { cookie: `homepage_admin_session=${token}` } }));
      if (r.ok) throw new Error("expected a confirmation");
      return r.response.json();
    };
    expect(await asked("sam")).toMatchObject({ reauthRequired: true, provider: "Nextcloud", password: true });
    // Made by the provider earlier in this file: no password of its own.
    expect(await asked("newbie")).toMatchObject({ provider: "Nextcloud", password: false });
  });
});
