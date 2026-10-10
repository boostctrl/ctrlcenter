import { describe, it, expect, beforeAll, vi } from "vitest";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";

// Groups (#299): list and replace, and the apps bulk change.
let route: typeof import("./route");
let bulk: typeof import("../apps/bulk/route");
let session: string;

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  route = await import("./route");
  bulk = await import("../apps/bulk/route");
  session = await adminSession();
});

const auth = (on: boolean) => (on ? session : undefined);
const get = (on = true) => route.GET(request("/api/groups", { session: auth(on) }));
const put = (body: unknown, on = true) =>
  route.PUT(request("/api/groups", { method: "PUT", body, session: auth(on) }));
const patch = (body: unknown, on = true) =>
  bulk.PATCH(request("/api/apps/bulk", { method: "PATCH", body, session: auth(on) }));

describe("/api/groups and /api/apps/bulk", () => {
  it("require a session", async () => {
    expect((await get(false)).status).toBe(401);
    expect((await put([], false)).status).toBe(401);
    expect((await patch({ ids: ["a"], groupName: "X" }, false)).status).toBe(401);
  });

  it("bulk-moves apps into a new group, which the list then shows", async () => {
    const { createApp } = await import("@/lib/config");
    const app = await createApp({
      ...(await import("@/lib/schema")).appInputSchema.parse({ name: "A", url: "https://a.example.com" }),
    });
    const res = await patch({ ids: [app.id], groupName: "Infra" });
    expect(res.status).toBe(200);
    expect((await res.json()).apps[0].group).toBe("infra");
    expect(await (await get()).json()).toEqual([{ id: "infra", name: "Infra" }]);
  });

  it("renames, refuses to delete a group in use with a 409, and 400s a bad list", async () => {
    const ok = await put([{ id: "infra", name: "Servers" }]);
    expect(ok.status).toBe(200);
    expect((await ok.json()).groups).toEqual([{ id: "infra", name: "Servers" }]);
    expect((await put([])).status).toBe(409);
    expect((await put([{ id: "a b", name: "X" }])).status).toBe(400);
  });

  it("keeps a group's icon and color, and drops a color outside the palette rather than the group (#316)", async () => {
    const groups = await (await get()).json();
    expect(groups.length).toBeGreaterThan(0);
    const styled = groups.map((g: { id: string; name: string }, i: number) =>
      i === 0 ? { ...g, icon: "proton", color: "emerald" } : i === 1 ? { ...g, color: "chartreuse" } : g
    );
    expect((await put(styled)).status).toBe(200);
    const after = await (await get()).json();
    expect(after[0]).toMatchObject({ icon: "proton", color: "emerald" });
    if (after[1]) {
      expect(after[1].id).toBe(groups[1].id);
      expect(after[1]).not.toHaveProperty("color");
    }
  });
});

