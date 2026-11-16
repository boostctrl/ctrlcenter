import { describe, it, expect, beforeAll, vi } from "vitest";
import { useScratchConfig, request, memberSession, staleSession, latestAuditEntry, TEST_ORIGIN } from "@/lib/testing/routes";

// Passkeys (#537): adding one, signing in with it, removing it. The WebAuthn
// checks themselves are SimpleWebAuthn's; here they're stood in for, and
// asked what they were told to expect.
const verifyRegistrationResponse = vi.fn();
const verifyAuthenticationResponse = vi.fn();
vi.mock("@simplewebauthn/server", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: (o: unknown) => verifyRegistrationResponse(o),
  verifyAuthenticationResponse: (o: unknown) => verifyAuthenticationResponse(o),
}));

let options: typeof import("./options/route").POST;
let add: typeof import("./route").POST;
let list: typeof import("./route").GET;
let remove: typeof import("./[id]/route").DELETE;
let signInOptions: typeof import("../auth/passkey/options/route").POST;
let signIn: typeof import("../auth/passkey/route").POST;
let config: typeof import("@/lib/config");
let auth: typeof import("@/lib/auth");
let sam: string;
const HOST = new URL(TEST_ORIGIN).hostname;

beforeAll(async () => {
  await useScratchConfig();
  ({ POST: options } = await import("./options/route"));
  ({ POST: add, GET: list } = await import("./route"));
  ({ DELETE: remove } = await import("./[id]/route"));
  ({ POST: signInOptions } = await import("../auth/passkey/options/route"));
  ({ POST: signIn } = await import("../auth/passkey/route"));
  config = await import("@/lib/config");
  auth = await import("@/lib/auth");
  sam = await memberSession("sam");
});

const cookiesOf = (res: Response) =>
  Object.fromEntries(res.headers.getSetCookie().map((c) => c.split(";")[0].split(/=(.*)/s).slice(0, 2)));
const withCookies = (session: string | null, extra: Record<string, string>) =>
  [session ? `homepage_admin_session=${session}` : "", ...Object.entries(extra).map(([k, v]) => `${k}=${v}`)].filter(Boolean).join("; ");

async function addPasskey(session: string, id: string, name: string) {
  const opts = await options(request("/api/passkeys/options", { method: "POST", session }));
  const { challenge } = await opts.json();
  verifyRegistrationResponse.mockResolvedValueOnce({
    verified: true,
    registrationInfo: { credential: { id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] } },
  });
  const res = await add(
    request("/api/passkeys", {
      method: "POST",
      body: { response: { id }, name },
      headers: { cookie: withCookies(session, { ctrlcenter_passkey_add: cookiesOf(opts).ctrlcenter_passkey_add }) },
    })
  );
  return { res, challenge };
}

describe("adding a passkey", () => {
  it("takes a recent confirmation before the browser's prompt", async () => {
    const stale = await memberSession("sam");
    await staleSession(stale);
    expect((await options(request("/api/passkeys/options", { method: "POST", session: stale }))).status).toBe(403);
  });

  it("checks the browser's answer against this ceremony, for this host, with user verification", async () => {
    const { res, challenge } = await addPasskey(sam, "cred-1", "Phone");
    expect(res.status).toBe(201);
    expect(verifyRegistrationResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedChallenge: challenge, expectedOrigin: TEST_ORIGIN, expectedRPID: HOST, requireUserVerification: true })
    );
    const stored = (await config.readConfigInternal()).auth.users.find((u) => u.id === "sam")?.passkeys;
    expect(stored).toEqual([expect.objectContaining({ id: "cred-1", name: "Phone", rpId: HOST, counter: 0, publicKey: "AQID" })]);
    expect(await latestAuditEntry()).toMatchObject({ kind: "passkey.added", detail: "Phone" });
    const shown = await (await list(request("/api/passkeys", { session: sam }))).json();
    expect(shown).toEqual({ host: HOST, passkeys: [expect.objectContaining({ id: "cred-1", name: "Phone" })] });
    expect(JSON.stringify(shown)).not.toContain("AQID");
  });

  it("refuses an answer that doesn't check out, or comes without its ceremony", async () => {
    const opts = await options(request("/api/passkeys/options", { method: "POST", session: sam }));
    verifyRegistrationResponse.mockResolvedValueOnce({ verified: false });
    const bad = await add(
      request("/api/passkeys", {
        method: "POST",
        body: { response: { id: "x" } },
        headers: { cookie: withCookies(sam, { ctrlcenter_passkey_add: cookiesOf(opts).ctrlcenter_passkey_add }) },
      })
    );
    expect(bad.status).toBe(400);
    expect((await add(request("/api/passkeys", { method: "POST", body: { response: { id: "x" } }, session: sam }))).status).toBe(400);
  });
});

describe("one account per credential id (#557)", () => {
  it("refuses a credential id another account holds", async () => {
    const { res } = await addPasskey(await memberSession("lee"), "cred-1", "Copy");
    expect(res.status).toBe(409);
    expect((await config.readConfigInternal()).auth.users.find((u) => u.id === "lee")?.passkeys).toEqual([]);
  });

  it("tries every account holding an id until one's key checks out", async () => {
    const { verifyAuthentication } = await import("@/lib/passkeys");
    const sam = (await config.readConfigInternal()).auth.users.find((u) => u.id === "sam")!;
    // As a file 3.3.0 wrote could hold it: the same id on two accounts.
    const twin = { ...sam, id: "twin", passkeys: sam.passkeys.map((p) => ({ ...p, publicKey: "AAAA" })) };
    verifyAuthenticationResponse
      .mockRejectedValueOnce(new Error("signature"))
      .mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter: 3 } });
    const found = await verifyAuthentication(
      request("/api/auth/passkey", { method: "POST" }),
      { id: "cred-1" } as never,
      "challenge",
      [twin, sam]
    );
    expect(found?.account.id).toBe("sam");
  });
});

describe("signing in with a passkey", () => {
  async function useIt(id: string, host?: string) {
    const headers: Record<string, string> = host ? { host } : {};
    const opts = await signInOptions(request("/api/auth/passkey/options", { method: "POST", headers }));
    const { challenge } = await opts.json();
    return {
      challenge,
      res: await signIn(
        request("/api/auth/passkey", {
          method: "POST",
          body: { response: { id } },
          headers: { ...headers, cookie: withCookies(null, { ctrlcenter_passkey: cookiesOf(opts).ctrlcenter_passkey }) },
        })
      ),
    };
  }

  it("signs in to the passkey's account, as two-factor, and keeps its new counter", async () => {
    verifyAuthenticationResponse.mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter: 7 } });
    const { res, challenge } = await useIt("cred-1");
    expect(res.status).toBe(200);
    expect(verifyAuthenticationResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedChallenge: challenge,
        expectedRPID: HOST,
        requireUserVerification: true,
        credential: expect.objectContaining({ id: "cred-1", counter: 0 }),
      })
    );
    const live = await auth.verifySession(cookiesOf(res).homepage_admin_session, (await config.readConfigInternal()).auth);
    expect(live?.account.id).toBe("sam");
    expect(live?.session).toMatchObject({ via: "passkey", twoFactor: true });
    const pk = (await config.readConfigInternal()).auth.users.find((u) => u.id === "sam")?.passkeys[0];
    expect(pk).toMatchObject({ counter: 7 });
    expect(pk?.lastUsedAt).not.toBeNull();
  });

  it("knows no passkey made elsewhere, none it doesn't have, and none that doesn't check out", async () => {
    expect((await useIt("cred-1", "other.test")).res.status).toBe(401);
    expect((await useIt("nobody")).res.status).toBe(401);
    verifyAuthenticationResponse.mockResolvedValueOnce({ verified: false });
    expect((await useIt("cred-1")).res.status).toBe(401);
  });

  it("won't sign in to a disabled account", async () => {
    await config.updateAccount("sam", { enabled: false });
    expect((await useIt("cred-1")).res.status).toBe(401);
    await config.updateAccount("sam", { enabled: true });
  });

  it("lets an account required to have two-factor add one, and its sessions aren't held", async () => {
    const kim = await memberSession("kim");
    await config.updateAccount("kim", { requireTwoFactor: true });
    expect((await addPasskey(kim, "cred-kim", "Laptop")).res.status).toBe(201);
    verifyAuthenticationResponse.mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter: 1 } });
    const { res } = await useIt("cred-kim");
    const { sessionNeedsTwoFactor } = await import("@/lib/accounts");
    const live = await auth.verifySession(cookiesOf(res).homepage_admin_session, (await config.readConfigInternal()).auth);
    expect(live && sessionNeedsTwoFactor(live.account, live.session)).toBe(false);
  });
});

describe("removing a passkey", () => {
  it("takes a recent confirmation, then removes it and records it", async () => {
    const stale = await memberSession("sam");
    await staleSession(stale);
    const del = (session: string) =>
      remove(request("/api/passkeys/cred-1", { method: "DELETE", session }), { params: Promise.resolve({ id: "cred-1" }) });
    expect((await del(stale)).status).toBe(403);
    expect((await del(sam)).status).toBe(204);
    expect(await latestAuditEntry()).toMatchObject({ kind: "passkey.removed", detail: "Phone" });
    expect((await del(sam)).status).toBe(404);
  });
});
