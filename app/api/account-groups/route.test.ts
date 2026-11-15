import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  useScratchConfig,
  request,
  adminSession,
  memberSession,
  staleSession,
  params,
  latestAuditEntry,
} from "@/lib/testing/routes";

// The groups list (#505): an admin adds, renames and removes groups, and
// every account and audience naming one follows; a member reaches none of
// it.
let POST: typeof import("./route").POST;
let PATCH: typeof import("./[id]/route").PATCH;
let DELETE: typeof import("./[id]/route").DELETE;
let listAccounts: typeof import("../accounts/route").GET;
let readConfigInternal: typeof import("@/lib/config").readConfigInternal;
let admin: string;

const CONFIG = `
apps:
  - { id: plex, name: Plex, url: "https://plex.test", private: true, audience: { groups: [family] } }
  - { id: nas, name: NAS, url: "https://nas.test", private: true, audience: { users: [sam], groups: [ops] } }
bookmarks:
  - { id: recipes, name: Recipes, url: "https://recipes.test", private: true, audience: { groups: [family] } }
`;

beforeAll(async () => {
  await useScratchConfig(CONFIG);
  vi.stubEnv("ADMIN_PASSWORD", "correct horse battery");
  ({ POST } = await import("./route"));
  ({ PATCH, DELETE } = await import("./[id]/route"));
  ({ GET: listAccounts } = await import("../accounts/route"));
  ({ readConfigInternal } = await import("@/lib/config"));
  admin = await adminSession();
  await memberSession("sam", ["family", "ops"]);
  await memberSession("kim", ["family"]);
});

const add = (id: unknown, session = admin) => POST(request("/api/account-groups", { method: "POST", body: { id }, session }));
const rename = (from: string, body: unknown, session = admin) =>
  PATCH(request(`/api/account-groups/${from}`, { method: "PATCH", body, session }), params({ id: from }));
const remove = (id: string, session = admin) =>
  DELETE(request(`/api/account-groups/${id}`, { method: "DELETE", session }), params({ id }));
const listing = async () => (await (await listAccounts(request("/api/accounts", { session: admin }))).json()) as {
  groups: string[];
  groupUsage: { id: string; members: string[]; apps: number; bookmarks: number; only: number }[];
};

describe("the groups list", () => {
  it("lists every group with what it holds", async () => {
    const body = await listing();
    expect(body.groups).toEqual(["family", "ops"]);
    expect(body.groupUsage.find((g) => g.id === "family")).toMatchObject({ members: ["sam", "kim"], apps: 1, bookmarks: 1, only: 2 });
  });

  it("adds an empty group for an admin; a member, a taken name or a bad one is refused", async () => {
    expect((await add("guests", await memberSession("zed"))).status).toBe(401);
    expect((await add("Guests ")).status).toBe(201);
    expect((await listing()).groups).toEqual(["family", "guests", "ops"]);
    expect((await add("guests")).status).toBe(409);
    expect((await add("not a slug")).status).toBe(400);
    expect(await latestAuditEntry()).toMatchObject({ kind: "group.changed", detail: "guests added" });
  });
});

describe("renaming a group", () => {
  it("takes a recent confirmation", async () => {
    const stale = await adminSession();
    await staleSession(stale);
    const res = await rename("family", { id: "household" }, stale);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reauthRequired: true });
  });

  it("renames it on every account and in every audience", async () => {
    expect((await rename("family", { id: "household" })).status).toBe(200);
    const c = await readConfigInternal();
    expect(c.auth.users.find((u) => u.id === "kim")?.groups).toEqual(["household"]);
    expect(c.apps.find((a) => a.id === "plex")?.audience).toEqual({ groups: ["household"] });
    expect(c.bookmarks[0].audience).toEqual({ groups: ["household"] });
    expect((await listing()).groups).toEqual(["guests", "household", "ops"]);
  });

  it("asks before merging into a group that exists, and merges when told to", async () => {
    const taken = await rename("ops", { id: "household" });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ exists: true });
    expect((await rename("ops", { id: "household", merge: true })).status).toBe(200);
    const c = await readConfigInternal();
    expect(c.auth.users.find((u) => u.id === "sam")?.groups).toEqual(["household"]);
    expect(c.apps.find((a) => a.id === "nas")?.audience).toEqual({ users: ["sam"], groups: ["household"] });
    expect(await latestAuditEntry()).toMatchObject({ kind: "group.changed", detail: "ops merged into household" });
  });

  it("answers 404 for a group that doesn't exist", async () => {
    expect((await rename("nobody", { id: "somebody" })).status).toBe(404);
  });
});

describe("removing a group", () => {
  it("takes a recent confirmation, then drops it everywhere; what it alone saw becomes admins-only", async () => {
    const stale = await adminSession();
    await staleSession(stale);
    expect((await remove("household", stale)).status).toBe(403);
    expect((await remove("household")).status).toBe(204);
    const c = await readConfigInternal();
    expect(c.auth.users.find((u) => u.id === "sam")?.groups).toEqual([]);
    expect(c.apps.find((a) => a.id === "plex")).not.toHaveProperty("audience");
    expect(c.apps.find((a) => a.id === "nas")?.audience).toEqual({ users: ["sam"] });
    expect((await listing()).groups).toEqual(["guests"]);
    expect((await remove("household")).status).toBe(404);
  });
});
