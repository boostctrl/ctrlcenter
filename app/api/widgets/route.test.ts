import { describe, it, expect, beforeAll, vi } from "vitest";
import { useScratchConfig, request, adminSession, staleSession } from "@/lib/testing/routes";
import { newInstance } from "@/lib/schema";

// Widget instances (#297): the admin replaces the whole list.
let route: typeof import("./route");
let session: string;

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  route = await import("./route");
  session = await adminSession();
});

const put = (body: unknown, auth = true) =>
  route.PUT(request("/api/widgets", { method: "PUT", body, session: auth ? session : undefined }));

describe("PUT /api/widgets", () => {
  it("requires a session", async () => {
    expect((await put([], false)).status).toBe(401);
  });

  it("rejects an invalid list with a readable 400", async () => {
    const res = await put([{ ...newInstance("feed", "f"), urls: ["ftp://x"] }]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/http/);
  });

  it("replaces the list and persists it", async () => {
    const list = [
      { ...newInstance("notes", "n1"), content: "one" },
      { ...newInstance("notes", "n2"), content: "two" },
    ];
    const res = await put(list);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(list);
    const { readConfigInternal } = await import("@/lib/config");
    expect((await readConfigInternal()).widgets.map((w) => w.id)).toEqual(["n1", "n2"]);
  });
});

describe("POST /api/widgets", () => {
  const post = (body: unknown, auth = true) =>
    route.POST(request("/api/widgets", { method: "POST", body, session: auth ? session : undefined }));

  it("requires a session and a known type", async () => {
    expect((await post({ type: "notes" }, false)).status).toBe(401);
    expect((await post({ type: "nope" })).status).toBe(400);
  });

  it("adds a widget with its defaults and a fresh id, keeping the rest", async () => {
    const { readConfigInternal } = await import("@/lib/config");
    const before = (await readConfigInternal()).widgets.length;
    const res = await post({ type: "feed" });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ type: "feed", urls: [""] });
    expect(created.id).toMatch(/^feed-[0-9a-f]{8}$/);
    const after = (await readConfigInternal()).widgets;
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)?.id).toBe(created.id);
  });

  it("asks a stale session to confirm before re-pointing an API widget, not for other edits (#378)", async () => {
    const api = { ...newInstance("api", "api-1"), url: "http://nas.lan/stats" };
    expect((await put([api])).status).toBe(200);
    const stale = await adminSession();
    await staleSession(stale);
    const putAs = (body: unknown) => route.PUT(request("/api/widgets", { method: "PUT", body, session: stale }));
    expect((await putAs([{ ...api, title: "NAS" }])).status).toBe(200);
    const moved = await putAs([{ ...api, url: "https://evil.example/" }]);
    expect(moved.status).toBe(403);
    expect(await moved.json()).toMatchObject({ reauthRequired: true });
    expect((await putAs([{ ...api, headers: [{ name: "X-Leak", value: "${NAS_TOKEN}" }] }])).status).toBe(403);
    expect((await putAs([api, { ...newInstance("api", "api-2"), url: "http://x.lan" }])).status).toBe(403);
    const { readConfigInternal } = await import("@/lib/config");
    expect((await readConfigInternal()).widgets).toEqual([{ ...api, title: "NAS" }]);
    // A recent confirmation lets it through.
    expect((await put([{ ...api, url: "https://other.lan/" }])).status).toBe(200);
  });
});

describe("PUT /api/widgets with the admin's placeholders (#382)", () => {
  it("answers with placeholders for header values and keeps the stored ones when they come back", async () => {
    const { SECRET_PLACEHOLDER } = await import("@/lib/schema");
    const api = { ...newInstance("api", "secretapi"), url: "http://x", headers: [{ name: "Authorization", value: "Bearer t" }] };
    const res = await put([api]);
    expect(res.status).toBe(200);
    expect((await res.json())[0].headers[0].value).toBe(SECRET_PLACEHOLDER);
    // Saved back as the form holds it, from a stale session: the value stays
    // and nothing moved, so no confirmation is asked.
    const stale = await adminSession();
    await staleSession(stale);
    const again = await route.PUT(
      request("/api/widgets", { method: "PUT", body: [{ ...api, headers: [{ name: "Authorization", value: SECRET_PLACEHOLDER }] }], session: stale })
    );
    expect(again.status).toBe(200);
    const { readConfigInternal } = await import("@/lib/config");
    const stored = (await readConfigInternal()).widgets.find((w) => w.id === "secretapi");
    expect(stored?.type === "api" && stored.headers[0].value).toBe("Bearer t");
  });
});

describe("PUT /api/widgets with a patch (#396)", () => {
  it("keeps an instance added elsewhere, applies edits by id, and drops a removed one's rows", async () => {
    const a = { ...newInstance("notes", "p-a"), content: "a" };
    const b = { ...newInstance("notes", "p-b"), content: "b" };
    expect((await put([a, b])).status).toBe(200);
    // The layout editor adds one meanwhile (POST), and places it.
    const added = await (await route.POST(request("/api/widgets", { method: "POST", body: { type: "notes" }, session }))).json();
    const { readConfigInternal, replaceBoards } = await import("@/lib/config");
    const boards = (await readConfigInternal()).boards;
    await replaceBoards(boards.map((bd, i) => ({
      id: bd.id, name: bd.name, visibility: bd.visibility,
      ...(i === 0 ? { layout: { sections: [{ widget: "p-b", span: 1 }, { widget: added.id, span: 1 }] } } : {}),
    })));
    // Settings → Widgets, from before the add: edits a, removes b.
    const res = await put({ upsert: [{ ...a, content: "a2" }], remove: ["p-b"] });
    expect(res.status).toBe(200);
    const stored = (await readConfigInternal());
    expect(stored.widgets.map((w) => w.id)).toEqual(["p-a", added.id]);
    expect(stored.widgets[0].type === "notes" && stored.widgets[0].content).toBe("a2");
    expect(stored.boards[0].layout.sections.map((r) => r.widget)).toEqual([added.id]);
    // The caps still hold over the combined list.
    const feeds = Array.from({ length: 9 }, (_, i) => ({ ...newInstance("feed", `f${i}`), urls: ["https://x/${i}"] }));
    expect((await put({ upsert: feeds })).status).toBe(400);
  });
});

describe("PUT /api/widgets over a cap (#426)", () => {
  it("lets a patch edit and trim a list already past the feed-card cap, not grow it", async () => {
    const { replaceWidgets, readConfigInternal } = await import("@/lib/config");
    const { MAX_FEED_CARDS } = await import("@/lib/schema");
    // As the 3.0 upgrade leaves a 2.x file with more feed cards than fit.
    const feeds = Array.from({ length: MAX_FEED_CARDS + 2 }, (_, i) => ({
      ...newInstance("feed", `f${i}`),
      urls: ["https://a.example/feed"],
    }));
    await replaceWidgets(feeds);
    expect((await put({ upsert: [{ ...feeds[0], count: 3 }] })).status).toBe(200);
    expect((await put({ remove: ["f1"] })).status).toBe(200);
    const res = await put({ upsert: [{ ...newInstance("feed", "f-more"), urls: ["https://b.example/feed"] }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(`At most ${MAX_FEED_CARDS} RSS feed cards`);
    const stored = (await readConfigInternal()).widgets;
    expect(stored.map((w) => w.id)).toEqual(feeds.filter((w) => w.id !== "f1").map((w) => w.id));
    expect(stored[0]).toMatchObject({ count: 3 });
  });
});
