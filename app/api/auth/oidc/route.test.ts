import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import * as YAML from "js-yaml";
import { useScratchConfig, request, memberSession, latestAuditEntry, TEST_ORIGIN } from "@/lib/testing/routes";
import { mockProvider, OP, CLIENT_ID, CLIENT_SECRET } from "@/lib/testing/oidc";

// Signing in through an OpenID Connect provider (#504), end to end against a
// stand-in provider: leaving for it, coming back, the accounts it reaches —
// only the one connected to the provider identity, never by username (#555)
// — and their groups, connecting an account, the second factor that may
// follow, and a confirmation.
let start: typeof import("./start/route").GET;
let callback: typeof import("./callback/route").GET;
let code: typeof import("../code/route").POST;
let config: typeof import("@/lib/config");
let auth: typeof import("@/lib/auth");
let oidc: typeof import("@/lib/oidc");
let provider: Awaited<ReturnType<typeof mockProvider>>;

const OIDC = { enabled: true, label: "Nextcloud", issuer: OP, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
// Connect an account to a provider identity, as its owner would from its page.
const link = (id: string, sub: string) => config.setProviderLink(id, { iss: OP, sub, name: id, linkedAt: Date.now() });
const setOidc = async (patch: Record<string, unknown>) =>
  config.setSignIn({ oidc: { ...(await config.readConfigInternal()).settings.signIn.oidc, ...patch } });

beforeAll(async () => {
  await useScratchConfig(YAML.dump({ settings: { signIn: { oidc: OIDC } }, auth: { groups: ["family"] } }));
  ({ GET: start } = await import("./start/route"));
  ({ GET: callback } = await import("./callback/route"));
  ({ POST: code } = await import("../code/route"));
  config = await import("@/lib/config");
  auth = await import("@/lib/auth");
  oidc = await import("@/lib/oidc");
  await memberSession("sam", ["ops"]);
  await link("sam", "u-sam");
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
  it("signs in to the account connected to that identity, with its groups that are on the list", async () => {
    const res = await signInAs({ sub: "u-sam", userinfo: { preferred_username: "Sam", groups: ["family", "admins"] } }, { next: "/boards/home" });
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

  it("never reaches an account by username, whatever name the provider gives (#555)", async () => {
    for (const name of ["sam", "admin"]) {
      const res = await signInAs({ sub: "u-evil", userinfo: { preferred_username: name } });
      expect(res.headers.get("location")).toMatch(/\/login\?error=not-linked$/);
      expect(setCookies(res).homepage_admin_session).toBeUndefined();
    }
  });

  it("makes a connected member for a new identity only when allowed, and never takes a name that's here", async () => {
    expect((await signInAs({ sub: "u-new", userinfo: { preferred_username: "newbie" } })).headers.get("location")).toMatch(/error=not-linked/);
    await setOidc({ createAccounts: true });
    const made = await signInAs({ sub: "u-new", userinfo: { preferred_username: "newbie", name: "New Bie" } });
    expect((await session(made))?.account).toMatchObject({
      id: "newbie",
      name: "New Bie",
      role: "member",
      passwordHash: "",
      provider: { iss: OP, sub: "u-new", name: "newbie" },
    });
    // The same identity again: the same account.
    expect((await session(await signInAs({ sub: "u-new", userinfo: { preferred_username: "renamed" } })))?.account.id).toBe("newbie");
    // Another identity with a name that's here, connected or not: refused.
    for (const name of ["newbie", "sam", "admin"]) {
      expect((await signInAs({ sub: "u-other", userinfo: { preferred_username: name } })).headers.get("location")).toMatch(
        new RegExp(`error=taken&name=${name}$`)
      );
    }
    expect((await signInAs({ sub: "u-other", userinfo: { preferred_username: "Not A Name" } })).headers.get("location")).toMatch(/error=name/);
    await setOidc({ createAccounts: false });
  });

  it("refuses a disabled account, and a callback without its flow", async () => {
    await config.updateAccount("sam", { enabled: false });
    expect((await signInAs({ sub: "u-sam" })).headers.get("location")).toMatch(/error=disabled/);
    await config.updateAccount("sam", { enabled: true });
    const stray = await callback(request("/api/auth/oidc/callback?code=x&state=y"));
    expect(stray.headers.get("location")).toMatch(/error=expired/);
  });

  it("refuses a forged state", async () => {
    const away = await start(request("/api/auth/oidc/start"));
    const flow = setCookies(away).ctrlcenter_oidc;
    const { code: c } = provider.signIn(away.headers.get("location") ?? "", { sub: "u-sam" });
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

describe("connecting an account (#555)", () => {
  it("connects the session's own account, confirmed just now, to the identity that signs in", async () => {
    const cookie = `homepage_admin_session=${await memberSession("kim")}`;
    const away = await start(request("/api/auth/oidc/start?purpose=link", { headers: { cookie } }));
    expect(new URL(away.headers.get("location") ?? "").searchParams.get("prompt")).toBe("login");
    const res = await signInAs({ sub: "u-kim", userinfo: { preferred_username: "kimberly" } }, { purpose: "link", cookie });
    expect(res.headers.get("location")).toMatch(/\/account\?provider=connected$/);
    expect((await config.readConfigInternal()).auth.users.find((u) => u.id === "kim")?.provider).toMatchObject({
      iss: OP,
      sub: "u-kim",
      name: "kimberly",
    });
    expect(await latestAuditEntry()).toMatchObject({ kind: "provider.linked", detail: "kimberly" });
    expect((await session(await signInAs({ sub: "u-kim" })))?.account.id).toBe("kim");
  });

  it("won't connect without a fresh confirmation, or without a session", async () => {
    const { staleSession } = await import("@/lib/testing/routes");
    const stale = await memberSession("kim");
    await staleSession(stale);
    const res = await start(request("/api/auth/oidc/start?purpose=link", { headers: { cookie: `homepage_admin_session=${stale}` } }));
    expect(res.headers.get("location")).toMatch(/\/account\?providerError=expired$/);
    expect((await start(request("/api/auth/oidc/start?purpose=link"))).headers.get("location")).toMatch(/providerError=expired/);
  });

  it("won't connect an identity another account here holds", async () => {
    const cookie = `homepage_admin_session=${await memberSession("pat")}`;
    const res = await signInAs({ sub: "u-sam" }, { purpose: "link", cookie });
    expect(res.headers.get("location")).toMatch(/providerError=in-use/);
    expect((await config.readConfigInternal()).auth.users.find((u) => u.id === "pat")?.provider).toBeNull();
  });
});

describe("an account with its own second factor", () => {
  let secret: string;
  beforeAll(async () => {
    const { generateTotpSecret } = await import("@/lib/totp");
    secret = generateTotpSecret();
    await memberSession("tfa");
    await config.activateTotp("tfa", secret, []);
    await link("tfa", "u-tfa");
  });

  it("enters its code after the provider, when the provider didn't vouch for one", async () => {
    const res = await signInAs({ sub: "u-tfa" }, { next: "/boards/home" });
    expect(res.headers.get("location")).toMatch(/\/login\?code=provider&next=%2Fboards%2Fhome$/);
    expect(setCookies(res).homepage_admin_session).toBeUndefined();
    const pending = setCookies(res).ctrlcenter_signin_code;
    const post = (totp: string) =>
      code(request("/api/auth/code", { method: "POST", body: { totp }, headers: { cookie: `ctrlcenter_signin_code=${pending}` } }));
    expect((await post("000000")).status).toBe(401);
    const { totpCode } = await import("@/lib/totp");
    const ok = await post(await totpCode(secret));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, next: "/boards/home", popup: false });
    expect((await session(ok))?.account.id).toBe("tfa");
  });

  it("goes straight in when the provider says a second factor was used", async () => {
    const res = await signInAs({ sub: "u-tfa", idClaims: { amr: ["pwd", "otp"] } });
    expect((await session(res))?.session.twoFactor).toBe(true);
  });

  it("goes straight in when the admin says the provider requires one", async () => {
    await setOidc({ enforcesTwoFactor: true });
    expect((await session(await signInAs({ sub: "u-tfa" })))?.account.id).toBe("tfa");
    await setOidc({ enforcesTwoFactor: false });
  });

  it("can't use a code step it wasn't given", async () => {
    const res = await code(request("/api/auth/code", { method: "POST", body: { totp: "123456" } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ expired: true });
  });
});

describe("confirming a session at the provider", () => {
  it("asks the provider for a fresh sign-in, and confirms the session it came from", async () => {
    const cookie = `homepage_admin_session=${await memberSession("sam")}`;
    const away = await start(request("/api/auth/oidc/start?purpose=reauth&popup=1", { headers: { cookie } }));
    const to = new URL(away.headers.get("location") ?? "");
    expect(to.searchParams.get("prompt")).toBe("login");
    expect(to.searchParams.get("max_age")).toBe("0");

    const res = await signInAs({ sub: "u-sam" }, { purpose: "reauth", popup: true, cookie });
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain('"ok":true');
    expect(await latestAuditEntry()).toMatchObject({ kind: "reauth.ok" });
  });

  it("won't confirm a session with another identity, even one giving the account's name (#555)", async () => {
    const cookie = `homepage_admin_session=${await memberSession("sam")}`;
    const res = await signInAs({ sub: "u-evil", userinfo: { preferred_username: "sam" } }, { purpose: "reauth", popup: true, cookie });
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
    expect(await out(await signInAs({ sub: "u-sam" }))).toEqual({ ok: true });

    await setOidc({ endProviderSession: true });
    const body = await out(await signInAs({ sub: "u-sam" }));
    const to = new URL(body.redirect);
    expect(to.origin + to.pathname).toBe(`${OP}/logout`);
    expect(to.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(to.searchParams.get("post_logout_redirect_uri")).toBe(`${TEST_ORIGIN}/`);
    await setOidc({ endProviderSession: false });
  });
});

describe("a confirmation for a provider's session", () => {
  it("offers the provider by name, and the password only to an account that has one", async () => {
    const { requireRecentAuth } = await import("@/lib/reauth");
    const { staleSession } = await import("@/lib/testing/routes");
    const asked = async (sub: string) => {
      const token = setCookies(await signInAs({ sub })).homepage_admin_session;
      await staleSession(token);
      const r = await requireRecentAuth(request("/api/x", { headers: { cookie: `homepage_admin_session=${token}` } }));
      if (r.ok) throw new Error("expected a confirmation");
      return r.response.json();
    };
    expect(await asked("u-sam")).toMatchObject({ reauthRequired: true, provider: "Nextcloud", password: true });
    // Made by the provider earlier in this file: no password of its own.
    expect(await asked("u-new")).toMatchObject({ provider: "Nextcloud", password: false });
  });
});
