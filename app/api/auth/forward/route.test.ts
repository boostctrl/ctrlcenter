import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import * as YAML from "js-yaml";
import { useScratchConfig, request, memberSession } from "@/lib/testing/routes";

// Signing in from the reverse proxy's headers (#504), through the route a
// page load is sent to.
let GET: typeof import("./route").GET;
let logout: typeof import("../../logout/route").POST;
let config: typeof import("@/lib/config");
let auth: typeof import("@/lib/auth");

const FA = { enabled: true, proxies: ["172.18.0.2"] };

beforeAll(async () => {
  await useScratchConfig(YAML.dump({ settings: { signIn: { forwardAuth: FA } }, auth: { groups: ["family"] } }));
  ({ GET } = await import("./route"));
  ({ POST: logout } = await import("../../logout/route"));
  config = await import("@/lib/config");
  auth = await import("@/lib/auth");
  await memberSession("sam", ["ops"]);
});
beforeEach(() => vi.stubEnv("CTRLCENTER_PEER_HEADER", "1"));

const setCookies = (res: Response) =>
  Object.fromEntries(
    res.headers.getSetCookie().map((c) => {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      return [pair.slice(0, i), pair.slice(i + 1)];
    })
  );
const fromProxy = (h: Record<string, string>, path = "/api/auth/forward?next=%2Fboards%2Fhome", cookie?: string) =>
  GET(request(path, { headers: { "x-ctrlcenter-peer": "172.18.0.2", ...h, ...(cookie ? { cookie } : {}) } }));
const live = async (res: Response) => {
  const token = setCookies(res).homepage_admin_session;
  return token ? auth.verifySession(token, (await config.readConfigInternal()).auth) : null;
};

describe("/api/auth/forward", () => {
  it("signs in to the account the proxy names, with its groups that are on the list", async () => {
    const res = await fromProxy({ "Remote-User": "Sam", "Remote-Groups": "family,admins" });
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/boards/home");
    const s = await live(res);
    expect(s?.account).toMatchObject({ id: "sam", groups: ["ops", "family"] });
    expect(s?.session).toMatchObject({ via: "forward", groups: ["family"] });
  });

  it("believes nothing from another address", async () => {
    const res = await GET(request("/api/auth/forward", { headers: { "x-ctrlcenter-peer": "203.0.113.9", "Remote-User": "sam" } }));
    expect(res.headers.get("location")).toMatch(/\/login\?error=no-header$/);
    expect(setCookies(res).homepage_admin_session).toBeUndefined();
  });

  it("refuses a name with no account unless the admin lets it make one", async () => {
    expect((await fromProxy({ "Remote-User": "newbie" }, "/api/auth/forward")).headers.get("location")).toMatch(
      /error=no-account&name=newbie/
    );
    await config.setSignIn({ forwardAuth: { ...(await config.readConfigInternal()).settings.signIn.forwardAuth, createAccounts: true } });
    expect((await live(await fromProxy({ "Remote-User": "newbie" })))?.account).toMatchObject({ id: "newbie", role: "member" });
    await config.setSignIn({ forwardAuth: { ...(await config.readConfigInternal()).settings.signIn.forwardAuth, createAccounts: false } });
  });

  it("replaces a session for another account, and keeps one for the same", async () => {
    const kim = await memberSession("kim");
    const res = await fromProxy({ "Remote-User": "sam" }, "/api/auth/forward", `homepage_admin_session=${kim}`);
    expect((await live(res))?.account.id).toBe("sam");
    expect(await auth.verifySession(kim, (await config.readConfigInternal()).auth)).toBeNull();

    const sam = setCookies(res).homepage_admin_session;
    const again = await fromProxy({ "Remote-User": "sam" }, "/api/auth/forward", `homepage_admin_session=${sam}`);
    expect(setCookies(again).homepage_admin_session).toBeUndefined();
    expect(await auth.verifySession(sam, (await config.readConfigInternal()).auth)).not.toBeNull();
  });

  it("stops for the account's own second factor unless the proxy is said to require one", async () => {
    const { generateTotpSecret } = await import("@/lib/totp");
    await memberSession("pat");
    await config.activateTotp("pat", generateTotpSecret(), []);
    const res = await fromProxy({ "Remote-User": "pat" });
    expect(res.headers.get("location")).toMatch(/\/login\?code=provider/);
    expect(setCookies(res).ctrlcenter_signin_code).toBeTruthy();

    await config.setSignIn({ forwardAuth: { ...(await config.readConfigInternal()).settings.signIn.forwardAuth, enforcesTwoFactor: true } });
    expect((await live(await fromProxy({ "Remote-User": "pat" })))?.session.twoFactor).toBe(true);
    await config.setSignIn({ forwardAuth: { ...(await config.readConfigInternal()).settings.signIn.forwardAuth, enforcesTwoFactor: false } });
  });

  it("signs out to the proxy's sign-out page, or else holds the headers off until asked", async () => {
    const out = async () => {
      const token = setCookies(await fromProxy({ "Remote-User": "sam" })).homepage_admin_session;
      return logout(request("/api/logout", { method: "POST", headers: { cookie: `homepage_admin_session=${token}` } }));
    };
    const held = await out();
    expect(await held.json()).toEqual({ ok: true });
    expect(setCookies(held).ctrlcenter_signed_out).toBe("1");

    await config.setSignIn({
      forwardAuth: { ...(await config.readConfigInternal()).settings.signIn.forwardAuth, logoutUrl: "https://auth.test/logout" },
    });
    const away = await out();
    expect(await away.json()).toEqual({ ok: true, redirect: "https://auth.test/logout" });
    expect(setCookies(away).ctrlcenter_signed_out).toBeUndefined();

    // Continuing clears the hold.
    const back = await fromProxy({ "Remote-User": "sam" }, "/api/auth/forward", "ctrlcenter_signed_out=1");
    expect(back.headers.getSetCookie().join()).toMatch(/ctrlcenter_signed_out=;/);
  });
});
