import { describe, it, expect, beforeAll } from "vitest";
import { useScratchConfig, request, adminSession, memberSession } from "@/lib/testing/routes";

// The accounts list for the admin's pickers (#423): names, roles and
// groups, nothing else, and for admins only.
let GET: typeof import("./route").GET;
beforeAll(async () => {
  await useScratchConfig();
  ({ GET } = await import("./route"));
});

describe("GET /api/accounts", () => {
  it("lists every account's name, role and groups, and the groups in use, without credentials", async () => {
    const member = await memberSession("sam", ["family"]);
    const res = await GET(request("/api/accounts", { session: await adminSession() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups).toEqual(["family"]);
    expect(body.accounts).toMatchObject([
      { id: "admin", name: "", role: "admin", enabled: true, groups: [], totp: false },
      { id: "sam", name: "", role: "member", enabled: true, groups: ["family"], totp: false, sessions: 1 },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|passwordSalt|secret|recoveryCodes|pendingSecret/);
    // A member may not list them, nor a visitor.
    expect((await GET(request("/api/accounts", { session: member }))).status).toBe(401);
    expect((await GET(request("/api/accounts"))).status).toBe(401);
  });
});
