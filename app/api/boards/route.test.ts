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
