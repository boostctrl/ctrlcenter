import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { useScratchConfig, request } from "@/lib/testing/routes";

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
