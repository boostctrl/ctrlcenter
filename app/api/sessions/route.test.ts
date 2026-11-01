import { describe, it, expect, beforeAll } from "vitest";
import { adminSession, params, request, useScratchConfig } from "@/lib/testing/routes";

// Route-handler tests for the session list (#365): the real handlers, a
// scratch volume, and tokens tied to session records — so ending a session
// is checked through the same verification the proxy and every admin route
// run.
let GET: typeof import("./route").GET;
let PATCH: typeof import("./route").PATCH;
let DELETE: typeof import("./[id]/route").DELETE;
let OTHERS: typeof import("./others/route").POST;
let LOGOUT: typeof import("../logout/route").POST;

beforeAll(async () => {
  await useScratchConfig();
  ({ GET, PATCH } = await import("./route"));
  ({ DELETE } = await import("./[id]/route"));
  ({ POST: OTHERS } = await import("./others/route"));
  ({ POST: LOGOUT } = await import("../logout/route"));
});

type Listed = { id: string; current: boolean; userAgent: string };
async function list(session: string): Promise<{ status: number; sessions: Listed[]; idleHours: number }> {
  const res = await GET(request("/api/sessions", { session }));
  const data = res.status === 200 ? await res.json() : { sessions: [], idleHours: 0 };
  return { status: res.status, ...data };
}

describe("/api/sessions", () => {
  it("refuses a signed-out caller", async () => {
    expect((await GET(request("/api/sessions"))).status).toBe(401);
    expect((await PATCH(request("/api/sessions", { method: "PATCH", body: { idleHours: 2 } }))).status).toBe(401);
    expect((await DELETE(request("/api/sessions/x", { method: "DELETE" }), params({ id: "x" }))).status).toBe(401);
    expect((await OTHERS(request("/api/sessions/others", { method: "POST" }))).status).toBe(401);
  });

  it("lists the live sessions with the caller's marked", async () => {
    const mine = await adminSession();
    await adminSession();
    const { status, sessions } = await list(mine);
    expect(status).toBe(200);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    // The record's id is what the list shows; no token ever leaves the server.
    expect(JSON.stringify(sessions)).not.toContain(mine);
  });

  it("ends one other session, which then can't call anything", async () => {
    const mine = await adminSession();
    const other = await adminSession();
    const otherId = (await list(other)).sessions.find((s) => s.current)!.id;
    const res = await DELETE(
      request(`/api/sessions/${otherId}`, { method: "DELETE", session: mine }),
      params({ id: otherId })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ended: true, current: false });
    expect((await list(other)).status).toBe(401);
    expect((await list(mine)).status).toBe(200);
  });

  it("ending the caller's own session clears the cookie", async () => {
    const mine = await adminSession();
    const myId = (await list(mine)).sessions.find((s) => s.current)!.id;
    const res = await DELETE(
      request(`/api/sessions/${myId}`, { method: "DELETE", session: mine }),
      params({ id: myId })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ended: true, current: true });
    expect(res.headers.get("set-cookie")).toMatch(/homepage_admin_session=;/);
    expect((await list(mine)).status).toBe(401);
  });

  it("signs out everywhere else, keeping the caller's session", async () => {
    const mine = await adminSession();
    const a = await adminSession();
    const b = await adminSession();
    const res = await OTHERS(request("/api/sessions/others", { method: "POST", session: mine }));
    expect(res.status).toBe(200);
    expect((await res.json()).ended).toBeGreaterThanOrEqual(2);
    expect((await list(a)).status).toBe(401);
    expect((await list(b)).status).toBe(401);
    const { status, sessions } = await list(mine);
    expect(status).toBe(200);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].current).toBe(true);
  });

  it("sets the idle timeout within its bounds", async () => {
    const mine = await adminSession();
    const ok = await PATCH(request("/api/sessions", { method: "PATCH", body: { idleHours: 6 }, session: mine }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).idleHours).toBe(6);
    expect((await list(mine)).idleHours).toBe(6);
    const tooLong = await PATCH(request("/api/sessions", { method: "PATCH", body: { idleHours: 500 }, session: mine }));
    expect(tooLong.status).toBe(400);
    const junk = await PATCH(request("/api/sessions", { method: "PATCH", body: { idleHours: "day" }, session: mine }));
    expect(junk.status).toBe(400);
    await PATCH(request("/api/sessions", { method: "PATCH", body: { idleHours: 24 }, session: mine }));
  });

  it("a cross-site request can't end sessions (CSRF)", async () => {
    const mine = await adminSession();
    const res = await OTHERS(
      request("/api/sessions/others", { method: "POST", session: mine, headers: { "sec-fetch-site": "cross-site" } })
    );
    expect(res.status).toBe(401);
    expect((await list(mine)).status).toBe(200);
  });
});

describe("POST /api/logout (#365)", () => {
  it("ends the session, so a kept copy of the cookie stops working", async () => {
    const mine = await adminSession();
    expect((await list(mine)).status).toBe(200);
    const res = await LOGOUT(request("/api/logout", { method: "POST", session: mine }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/homepage_admin_session=;/);
    expect((await list(mine)).status).toBe(401);
  });

  it("is fine without a session, and refuses a cross-site request", async () => {
    expect((await LOGOUT(request("/api/logout", { method: "POST" }))).status).toBe(200);
    const res = await LOGOUT(request("/api/logout", { method: "POST", headers: { "sec-fetch-site": "cross-site" } }));
    expect(res.status).toBe(403);
  });
});

describe("the idle timeout (#382)", () => {
  it("can be shortened on the session alone, but lengthening it asks a stale session to confirm", async () => {
    const { staleSession } = await import("@/lib/testing/routes");
    const session = await adminSession();
    const patch = (idleHours: number) => PATCH(request("/api/sessions", { method: "PATCH", body: { idleHours }, session }));
    expect((await patch(12)).status).toBe(200);
    await staleSession(session);
    expect((await patch(6)).status).toBe(200);
    const longer = await patch(48);
    expect(longer.status).toBe(403);
    expect(await longer.json()).toMatchObject({ reauthRequired: true });
    expect((await list(session)).idleHours).toBe(6);
  });
});
