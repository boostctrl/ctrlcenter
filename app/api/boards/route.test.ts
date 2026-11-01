import { describe, it, expect, beforeAll, vi } from "vitest";
import { useScratchConfig, request, adminSession, params } from "@/lib/testing/routes";

// Boards (#298): the admin replaces the list; the layout editor saves one
// board's rows.
let route: typeof import("./route");
let layoutRoute: typeof import("./[id]/layout/route");
let session: string;

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  route = await import("./route");
  layoutRoute = await import("./[id]/layout/route");
  session = await adminSession();
});

const put = (body: unknown, auth = true) =>
  route.PUT(request("/api/boards", { method: "PUT", body, session: auth ? session : undefined }));
const putLayout = (id: string, body: unknown, auth = true) =>
  layoutRoute.PUT(
    request(`/api/boards/${id}/layout`, { method: "PUT", body, session: auth ? session : undefined }),
    params({ id })
  );
const stored = async () => (await import("@/lib/config")).readConfigInternal();

describe("PUT /api/boards", () => {
  it("requires a session", async () => {
    expect((await put([], false)).status).toBe(401);
  });

  it("rejects an invalid list with a 400", async () => {
    expect((await put([])).status).toBe(400);
    expect((await put([{ id: "a b", name: "", visibility: "public" }])).status).toBe(400);
  });

  it("sets a board's icon, keeps it when a save leaves it out, and clears it with \"\" (#316)", async () => {
    const current = (await stored()).boards.map(({ id, name, visibility }) => ({ id, name, visibility }));
    const home = current[0].id;
    expect((await put(current.map((b) => (b.id === home ? { ...b, icon: "jellyfin" } : b)))).status).toBe(200);
    expect((await stored()).boards[0].icon).toBe("jellyfin");
    // The editor's board menu saves without icons.
    expect((await put(current)).status).toBe(200);
    expect((await stored()).boards[0].icon).toBe("jellyfin");
    expect((await put(current.map((b) => (b.id === home ? { ...b, icon: "" } : b)))).status).toBe(200);
    expect((await stored()).boards[0]).not.toHaveProperty("icon");
  });

  it("keeps a board's stored rows when none are sent, and starts a new board empty", async () => {
    const before = (await stored()).boards[0].layout;
    const res = await put([
      { id: "infra", name: "Infra", visibility: "private" },
      { id: "home", name: "Start", visibility: "public" },
    ]);
    expect(res.status).toBe(200);
    const { boards } = await stored();
    expect(boards.map((b) => [b.id, b.name, b.visibility])).toEqual([
      ["infra", "Infra", "private"],
      ["home", "Start", "public"],
    ]);
    expect(boards[1].layout).toEqual(before);
    expect(boards[0].layout.sections).toEqual([]);
  });

  it("replaces a board's rows when they're sent", async () => {
    await put([
      { id: "infra", name: "Infra", visibility: "private", layout: { sections: [{ widget: "notes", span: 12 }] } },
      { id: "home", name: "Start", visibility: "public" },
    ]);
    expect((await stored()).boards[0].layout.sections).toEqual([{ widget: "notes", span: 12 }]);
  });
});

describe("PUT /api/boards/<id>/layout", () => {
  it("requires a session", async () => {
    expect((await putLayout("home", { sections: [] }, false)).status).toBe(401);
  });

  it("404s an unknown board and 400s bad rows", async () => {
    expect((await putLayout("nope", { sections: [] })).status).toBe(404);
    expect((await putLayout("home", { sections: [{ widget: "apps", span: 30 }] })).status).toBe(400);
  });

  it("saves the board's rows and the site-wide page values", async () => {
    const sections = [{ widget: "apps", span: 12, hidden: false, cards: 3 }];
    const res = await putLayout("home", { sections, scale: 110, gap: 24 });
    expect(res.status).toBe(200);
    const config = await stored();
    expect(config.boards.find((b) => b.id === "home")?.layout.sections).toEqual(sections);
    expect(config.boards.find((b) => b.id === "infra")?.layout.sections).toEqual([{ widget: "notes", span: 12 }]);
    expect(config.settings.layout).toMatchObject({ scale: 110, gap: 24 });
  });
});

describe("PUT /api/boards with a patch (#396)", () => {
  it("touches only the boards named, so another tab's board and its visibility survive", async () => {
    const current = (await stored()).boards.map(({ id, name, visibility }) => ({ id, name, visibility }));
    const home = current[0].id;
    // Tab B: a private board, and the home board set private.
    expect(
      (await put([...current.map((b) => (b.id === home ? { ...b, visibility: "private" } : b)), { id: "infra-396", name: "Infra 396", visibility: "private" }])).status
    ).toBe(200);
    // Tab A, from its page-load copy: renames the home board with a patch.
    const res = await put({ upsert: [{ id: home, name: "Front", visibility: "private" }] });
    expect(res.status).toBe(200);
    const boards = (await stored()).boards;
    expect(boards.map((b) => [b.id, b.name, b.visibility])).toEqual(
      expect.arrayContaining([[home, "Front", "private"], ["infra-396", "Infra 396", "private"]])
    );
    // Remove and reorder, and the last board can't go.
    expect((await put({ remove: ["infra-396"] })).status).toBe(200);
    expect((await stored()).boards.some((b) => b.id === "infra-396")).toBe(false);
    const ids = (await stored()).boards.map((b) => b.id);
    if (ids.length > 1) {
      expect((await put({ order: [...ids].reverse() })).status).toBe(200);
      expect((await stored()).boards.map((b) => b.id)).toEqual([...ids].reverse());
    }
    expect((await put({ remove: (await stored()).boards.map((b) => b.id) })).status).toBe(400);
    expect((await put({ upsert: "nope" })).status).toBe(400);
  });
});
