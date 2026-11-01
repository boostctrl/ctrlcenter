import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { useScratchConfig, request } from "@/lib/testing/routes";
import { FOUNDING_ACCOUNT_ID } from "@/lib/schema";

// Route-handler tests for sign-in (#289): the real handler, a scratch config,
// and NextRequests — so the CSRF check, the per-client throttle and the
// password check run as they do in production.
let POST: typeof import("./route").POST;
let ip = 0;

// Each test signs in from its own address: the per-client throttle is module
// state shared by every test in this file.
function login(password: unknown, headers: Record<string, string> = {}) {
  return POST(
    request("/api/login", {
      method: "POST",
      body: { password },
      headers: { "x-forwarded-for": `10.0.0.${ip}`, ...headers },
    })
  );
}

beforeAll(async () => {
  await useScratchConfig();
  ({ POST } = await import("./route"));
});

beforeEach(() => {
  ip += 1;
  vi.stubEnv("ADMIN_PASSWORD", "correct horse");
});

describe("POST /api/login", () => {
  it("issues a session cookie for the right password", async () => {
    const res = await login("correct horse");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/homepage_admin_session=/);
  });

  it("rejects a wrong password with 401 and no cookie", async () => {
    const res = await login("wrong");
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a cross-site request before checking anything (CSRF)", async () => {
    const res = await login("correct horse", { "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
  });

  it("throttles a client after five attempts, with Retry-After", async () => {
    for (let i = 0; i < 5; i++) expect((await login("wrong")).status).toBe(401);
    const blocked = await login("correct horse");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("doesn't count successful sign-ins toward the limit (#277)", async () => {
    for (let i = 0; i < 8; i++) expect((await login("correct horse")).status).toBe(200);
  });

  it("explains a missing admin password instead of rejecting (#275)", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    const res = await login("anything");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/No admin password is set/);
  });

  it("records sign-ins and failed attempts in the security log (#368)", async () => {
    const { listSecurityEvents } = await import("@/lib/security-events");
    const before = (await listSecurityEvents(200)).length;
    expect((await login("wrong")).status).toBe(401);
    expect((await login("wrong")).status).toBe(401);
    expect((await login("correct horse")).status).toBe(200);
    const events = (await listSecurityEvents(200)).slice(0, (await listSecurityEvents(200)).length - before);
    expect(events.map((e) => e.kind)).toEqual(["signin.ok", "signin.fail"]);
    // The two failures folded into one entry; the address is the throttle's.
    expect(events[1]).toMatchObject({ count: 2, ip: `10.0.0.${ip}` });
    expect(events[0]).toMatchObject({ ip: `10.0.0.${ip}`, newAddress: true });
  });

  it("records whether the sign-in came through a proxy only from the production entry (#383)", async () => {
    const { listSessions } = await import("@/lib/sessions");
    // The session this sign-in starts.
    async function signIn(headers: Record<string, string>) {
      const before = new Set((await listSessions()).map((s) => s.id));
      expect((await login("correct horse", headers)).status).toBe(200);
      return (await listSessions()).find((s) => !before.has(s.id));
    }
    // Next fills X-Forwarded-For in on every request (each login() here sends
    // one), so the header itself never counts.
    expect((await signIn({}))?.forwarded).toBeNull();
    // Without the entry a client-sent stamp is ignored.
    expect((await signIn({ "x-ctrlcenter-forwarded": "0" }))?.forwarded).toBeNull();
    vi.stubEnv("CTRLCENTER_PEER_HEADER", "1");
    try {
      const peer = { "x-ctrlcenter-peer": "203.0.113.9" };
      expect((await signIn({ ...peer, "x-ctrlcenter-forwarded": "0" }))?.forwarded).toBe(false);
      expect((await signIn({ ...peer, "x-ctrlcenter-forwarded": "1" }))?.forwarded).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("names the cookie __Host- over HTTPS, so another host or path can't plant one (#369)", async () => {
    const res = await login("correct horse", { "x-forwarded-proto": "https" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^__Host-homepage_admin_session=.*Secure/);
  });

  it("locks a client out for longer each time it trips the throttle (#369)", async () => {
    for (let i = 0; i < 5; i++) expect((await login("wrong")).status).toBe(401);
    const first = Number((await login("wrong")).headers.get("retry-after"));
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(5 * 60);
    vi.useFakeTimers({ now: Date.now() + first * 1000 + 1000 });
    try {
      for (let i = 0; i < 5; i++) expect((await login("wrong")).status).toBe(401);
      const second = Number((await login("wrong")).headers.get("retry-after"));
      expect(second).toBeGreaterThan(5 * 60);
      expect(second).toBeLessThanOrEqual(10 * 60);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("POST /api/login throttle gaps (#392)", () => {
  const SECRET = "JBSWY3DPEHPK3PXP";
  const loginWith = (body: unknown, headers: Record<string, string> = {}) =>
    POST(
      request("/api/login", {
        method: "POST",
        body,
        headers: { "x-forwarded-for": `10.0.0.${ip}`, ...headers },
      })
    );
  async function withTotp<T>(fn: () => Promise<T>): Promise<T> {
    const { activateTotp, disableTotp } = await import("@/lib/config");
    await activateTotp(FOUNDING_ACCOUNT_ID, SECRET, []);
    try {
      return await fn();
    } finally {
      await disableTotp(FOUNDING_ACCOUNT_ID);
    }
  }
  const code = async () => (await import("@/lib/totp")).totpCode(SECRET);

  it("keys the throttle on an IPv6 /64, so rotating through one allotment doesn't help", async () => {
    const block = `2001:db8:${ip}:7`;
    for (let i = 1; i <= 5; i++) {
      expect((await login("wrong", { "x-forwarded-for": `${block}::${i}` })).status).toBe(401);
    }
    expect(
      (await login("wrong", { "x-forwarded-for": `${block}:ffff:ffff:ffff:ffff` })).status
    ).toBe(429);
    // The next /64 is another client.
    expect((await login("wrong", { "x-forwarded-for": `2001:db8:${ip}:8::1` })).status).toBe(401);
  });

  it("charges a two-factor sign-in once, not twice: the password-only step is given back", async () =>
    withTotp(async () => {
      for (let i = 0; i < 8; i++) {
        const step1 = await login("correct horse");
        expect(step1.status).toBe(401);
        expect(await step1.json()).toMatchObject({ totpRequired: true });
      }
      expect((await loginWith({ password: "correct horse", totp: await code() })).status).toBe(200);
    }));

  // Last in the file: once tripped, the shared wrong-code budget stays spent
  // for the rest of this worker's life.
  it("pauses code checks for everyone once twenty wrong codes came from anywhere", async () =>
    withTotp(async () => {
      // Twenty wrong codes, four per address, so no one client trips its own
      // lockout.
      for (let i = 0; i < 20; i++) {
        const res = await loginWith(
          { password: "correct horse", totp: "000000" },
          { "x-forwarded-for": `10.1.${ip}.${Math.floor(i / 4) + 1}` }
        );
        expect(res.status).toBe(401);
      }
      // Now even the right code is refused, with Retry-After, from anywhere.
      const paused = await loginWith(
        { password: "correct horse", totp: await code() },
        { "x-forwarded-for": `10.1.${ip}.200` }
      );
      expect(paused.status).toBe(429);
      expect(Number(paused.headers.get("retry-after"))).toBeGreaterThan(0);
      // The audit log says so, once, and names the codes rather than an address.
      const { listSecurityEvents } = await import("@/lib/security-events");
      const locked = (await listSecurityEvents(200)).filter(
        (e) => e.kind === "signin.locked" && e.detail === "authentication codes"
      );
      expect(locked).toHaveLength(1);
    }));
});

describe("POST /api/login with a username (#423)", () => {
  function loginAs(username: unknown, password: string) {
    ip += 1;
    return POST(
      request("/api/login", {
        method: "POST",
        body: { username, password },
        headers: { "x-forwarded-for": `10.0.1.${ip}` },
      })
    );
  }

  it("signs in the account named, however it is typed, and refuses an unknown name like a wrong password", async () => {
    expect((await loginAs("admin", "correct horse")).status).toBe(200);
    expect((await loginAs(" Admin ", "correct horse")).status).toBe(200);
    const res = await loginAs("nobody", "correct horse");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid password" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("binds the session to the account that signed in", async () => {
    const res = await loginAs(FOUNDING_ACCOUNT_ID, "correct horse");
    const token = /homepage_admin_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
    const { decodeJwt } = await import("jose");
    expect(decodeJwt(token).sub).toBe(FOUNDING_ACCOUNT_ID);
  });
});
