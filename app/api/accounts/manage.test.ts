import { describe, it, expect, beforeAll, vi } from "vitest";
import { useScratchConfig, request, adminSession, memberSession, staleSession, params } from "@/lib/testing/routes";

// Managing accounts (#423): an admin adds, edits, removes, resets and signs
// out accounts, with step-up where it matters; a member reaches only its
// own password, second factor and sessions.
let POST: typeof import("./route").POST;
let GET: typeof import("./route").GET;
let PATCH: typeof import("./[id]/route").PATCH;
let DELETE: typeof import("./[id]/route").DELETE;
let resetPassword: typeof import("./[id]/password/route").POST;
let endSessions: typeof import("./[id]/sessions/end/route").POST;
let dropTotp: typeof import("./[id]/totp/route").DELETE;
let login: typeof import("../login/route").POST;
let sessionsGet: typeof import("../sessions/route").GET;
let sessionEnd: typeof import("../sessions/[id]/route").DELETE;
let changePassword: typeof import("../password/route").POST;
let admin: string;
let ip = 0;
const json = (res: Response) => res.json() as Promise<Record<string, unknown>>;

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "correct horse battery");
  ({ POST, GET } = await import("./route"));
  ({ PATCH, DELETE } = await import("./[id]/route"));
  ({ POST: resetPassword } = await import("./[id]/password/route"));
  ({ POST: endSessions } = await import("./[id]/sessions/end/route"));
  ({ DELETE: dropTotp } = await import("./[id]/totp/route"));
  ({ POST: login } = await import("../login/route"));
  ({ GET: sessionsGet } = await import("../sessions/route"));
  ({ DELETE: sessionEnd } = await import("../sessions/[id]/route"));
  ({ POST: changePassword } = await import("../password/route"));
  admin = await adminSession();
});

// `session` "" is a visitor: no cookie at all.
const create = (body: unknown, session: string = admin) =>
  POST(request("/api/accounts", { method: "POST", body, ...(session ? { session } : {}) }));
const signIn = (username: string, password: string) => {
  ip += 1;
  return login(request("/api/login", { method: "POST", body: { username, password }, headers: { "x-forwarded-for": `10.9.0.${ip}` } }));
};

describe("POST /api/accounts", () => {
  it("adds an account for an admin with a recent confirmation, never for a member or a visitor", async () => {
    const sam = { id: "sam", name: "Sam", role: "member", groups: ["family"], password: "sam-secret-12345" };
    expect((await create(sam, await memberSession("zed"))).status).toBe(401);
    expect((await create(sam, "")).status).toBe(401);
    const stale = await adminSession();
    await staleSession(stale);
    const refused = await create(sam, stale);
    expect(refused.status).toBe(403);
    expect(await json(refused)).toMatchObject({ reauthRequired: true });
    const res = await create(sam);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body).toMatchObject({ id: "sam", name: "Sam", role: "member", groups: ["family"], enabled: true, mustChangePassword: true, totp: false });
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|passwordSalt|secret/);
    expect((await create(sam)).status).toBe(409);
    expect((await create({ ...sam, id: "Not A Slug" })).status).toBe(400);
    expect((await create({ ...sam, id: "kim", password: "short" })).status).toBe(400);
  });

  it("lists what the Users tab shows, with sessions counted per account", async () => {
    await memberSession("sam");
    const body = await json(await GET(request("/api/accounts", { session: admin })));
    const sam = (body.accounts as Record<string, unknown>[]).find((a) => a.id === "sam");
    expect(sam).toMatchObject({ role: "member", totp: false, mustChangePassword: true, sessions: 1 });
    expect(typeof sam?.createdAt).toBe("string");
  });
});

describe("the account's first sign-in and its own changes", () => {
  it("signs in with the password it was given and is told to choose its own", async () => {
    const res = await signIn("sam", "sam-secret-12345");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, mustChangePassword: true });
  });

  it("changes its own password, which clears the flag and ends its other sessions", async () => {
    const other = await memberSession("sam");
    const mine = await memberSession("sam");
    const res = await changePassword(
      request("/api/password", { method: "POST", body: { current: "sam-secret-12345", next: "sam-own-choice-98" }, session: mine })
    );
    expect(res.status).toBe(200);
    expect((await sessionsGet(request("/api/sessions", { session: other }))).status).toBe(401);
    const again = await signIn("sam", "sam-own-choice-98");
    expect(await json(again)).toEqual({ ok: true, mustChangePassword: false });
    const listed = await json(await GET(request("/api/accounts", { session: admin })));
    expect((listed.accounts as Record<string, unknown>[]).find((a) => a.id === "sam")).toMatchObject({ mustChangePassword: false });
  });

  it("sees and ends only its own sessions", async () => {
    const mine = await memberSession("sam");
    const kim = await memberSession("kim");
    const listed = await json(await sessionsGet(request("/api/sessions", { session: mine })));
    const sessions = listed.sessions as { account?: string; id: string; current: boolean }[];
    expect(sessions.every((s) => s.account === "sam")).toBe(true);
    expect(sessions.some((s) => s.current)).toBe(true);
    const all = await json(await sessionsGet(request("/api/sessions", { session: admin })));
    const kimsId = (all.sessions as { account?: string; id: string }[]).find((s) => s.account === "kim")?.id ?? "";
    const refused = await sessionEnd(request(`/api/sessions/${kimsId}`, { method: "DELETE", session: mine }), params({ id: kimsId }));
    expect(await json(refused)).toMatchObject({ ended: false });
    expect((await sessionsGet(request("/api/sessions", { session: kim }))).status).toBe(200);
  });
});

describe("PATCH, DELETE and the admin's resets", () => {
  it("renames, regroups and disables an account, ending its sessions, and refuses to disable or demote oneself", async () => {
    const samSession = await memberSession("sam");
    const res = await PATCH(request("/api/accounts/sam", { method: "PATCH", body: { name: "Samantha", groups: ["family", "ops"], enabled: false }, session: admin }), params({ id: "sam" }));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ name: "Samantha", groups: ["family", "ops"], enabled: false });
    expect((await sessionsGet(request("/api/sessions", { session: samSession }))).status).toBe(401);
    expect((await signIn("sam", "sam-own-choice-98")).status).toBe(401);
    await PATCH(request("/api/accounts/sam", { method: "PATCH", body: { enabled: true }, session: admin }), params({ id: "sam" }));
    const self = await PATCH(request("/api/accounts/admin", { method: "PATCH", body: { enabled: false }, session: admin }), params({ id: "admin" }));
    expect(self.status).toBe(400);
    expect((await PATCH(request("/api/accounts/nobody", { method: "PATCH", body: { name: "x" }, session: admin }), params({ id: "nobody" }))).status).toBe(404);
  });

  it("makes someone an admin only with a recent confirmation", async () => {
    const stale = await adminSession();
    await staleSession(stale);
    const refused = await PATCH(request("/api/accounts/sam", { method: "PATCH", body: { role: "admin" }, session: stale }), params({ id: "sam" }));
    expect(refused.status).toBe(403);
    const res = await PATCH(request("/api/accounts/sam", { method: "PATCH", body: { role: "admin" }, session: admin }), params({ id: "sam" }));
    expect(await json(res)).toMatchObject({ role: "admin" });
    await PATCH(request("/api/accounts/sam", { method: "PATCH", body: { role: "member" }, session: admin }), params({ id: "sam" }));
  });

  it("resets a password, ending the account's sessions and requiring a new one at sign-in", async () => {
    const samSession = await memberSession("sam");
    const res = await resetPassword(request("/api/accounts/sam/password", { method: "POST", body: { password: "handed-over-pass1" }, session: admin }), params({ id: "sam" }));
    expect(res.status).toBe(200);
    expect((await sessionsGet(request("/api/sessions", { session: samSession }))).status).toBe(401);
    expect((await signIn("sam", "sam-own-choice-98")).status).toBe(401);
    expect(await json(await signIn("sam", "handed-over-pass1"))).toEqual({ ok: true, mustChangePassword: true });
    const own = await resetPassword(request("/api/accounts/admin/password", { method: "POST", body: { password: "whatever-pass-123" }, session: admin }), params({ id: "admin" }));
    expect(own.status).toBe(400);
  });

  it("signs an account out everywhere and turns its second factor off", async () => {
    await memberSession("sam");
    await memberSession("sam");
    const before = await json(await GET(request("/api/accounts", { session: admin })));
    const held = (before.accounts as Record<string, unknown>[]).find((a) => a.id === "sam")?.sessions;
    expect(held).toBeGreaterThanOrEqual(2);
    const ended = await endSessions(request("/api/accounts/sam/sessions/end", { method: "POST", session: admin }), params({ id: "sam" }));
    expect(await json(ended)).toMatchObject({ ok: true, ended: held });
    const after = await json(await GET(request("/api/accounts", { session: admin })));
    expect((after.accounts as Record<string, unknown>[]).find((a) => a.id === "sam")?.sessions).toBe(0);
    const { activateTotp, readConfigInternal } = await import("@/lib/config");
    await activateTotp("sam", "JBSWY3DPEHPK3PXP", []);
    const res = await dropTotp(request("/api/accounts/sam/totp", { method: "DELETE", session: admin }), params({ id: "sam" }));
    expect(res.status).toBe(200);
    const { findAccount } = await import("@/lib/accounts");
    expect(findAccount((await readConfigInternal()).auth, "sam")?.totp.enabled).toBe(false);
  });

  it("removes an account with a recent confirmation, never the founding admin", async () => {
    expect((await DELETE(request("/api/accounts/admin", { method: "DELETE", session: admin }), params({ id: "admin" }))).status).toBe(400);
    const samSession = await memberSession("sam");
    const res = await DELETE(request("/api/accounts/sam", { method: "DELETE", session: admin }), params({ id: "sam" }));
    expect(res.status).toBe(204);
    expect((await sessionsGet(request("/api/sessions", { session: samSession }))).status).toBe(401);
    expect((await DELETE(request("/api/accounts/sam", { method: "DELETE", session: admin }), params({ id: "sam" }))).status).toBe(404);
    const { listSecurityEvents } = await import("@/lib/security-events");
    const kinds = (await listSecurityEvents(100)).map((e) => e.kind);
    for (const k of ["account.created", "account.changed", "password.reset", "account.deleted"]) expect(kinds).toContain(k);
  });
});
