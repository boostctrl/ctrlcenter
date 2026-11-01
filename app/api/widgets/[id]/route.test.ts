import { describe, it, expect, beforeAll, vi } from "vitest";
import { useScratchConfig, request, adminSession, params, staleSession } from "@/lib/testing/routes";
import { newInstance } from "@/lib/schema";

// One widget edited in place from the layout editor (#303).
let route: typeof import("./route");
let session: string;

const calendar = { ...newInstance("calendar", "cal-1"), url: "https://dav.example/cal", username: "me", password: "s3cret" };
const notes = { ...newInstance("notes", "notes-1"), content: "keep me" };

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  route = await import("./route");
  session = await adminSession();
  const { replaceWidgets } = await import("@/lib/config");
  await replaceWidgets([calendar, notes]);
});

const get = (id: string, auth = true) =>
  route.GET(request(`/api/widgets/${id}`, { session: auth ? session : undefined }), params({ id }));
const put = (id: string, body: unknown, auth = true) =>
  route.PUT(request(`/api/widgets/${id}`, { method: "PUT", body, session: auth ? session : undefined }), params({ id }));
const del = (id: string, auth = true) =>
  route.DELETE(request(`/api/widgets/${id}`, { method: "DELETE", session: auth ? session : undefined }), params({ id }));

describe("/api/widgets/[id]", () => {
  it("requires a session", async () => {
    expect((await get("cal-1", false)).status).toBe(401);
    expect((await put("cal-1", calendar, false)).status).toBe(401);
    expect((await del("cal-1", false)).status).toBe(401);
  });

  it("answers with the instance, a placeholder for its credential (#382), and what its editor needs", async () => {
    const { SECRET_PLACEHOLDER } = await import("@/lib/schema");
    const res = await get("cal-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.widget).toMatchObject({ username: "me", password: SECRET_PLACEHOLDER });
    expect(Array.isArray(body.groups)).toBe(true);
    expect(Array.isArray(body.tags)).toBe(true);
    expect(Array.isArray(body.integrations)).toBe(true);
    expect((await get("nope")).status).toBe(404);
    // Saved back as the editor holds it, the stored password stays.
    expect((await put("cal-1", body.widget)).status).toBe(200);
    const { readConfigInternal } = await import("@/lib/config");
    const stored = (await readConfigInternal()).widgets.find((w) => w.id === "cal-1");
    expect(stored?.type === "calendar" && stored.password).toBe("s3cret");
  });

  it("saves one instance and leaves the others exactly as stored", async () => {
    const res = await put("cal-1", { ...calendar, count: 9 });
    expect(res.status).toBe(200);
    const { readConfigInternal } = await import("@/lib/config");
    const stored = (await readConfigInternal()).widgets;
    expect(stored.find((w) => w.id === "cal-1")).toMatchObject({ count: 9, password: "s3cret" });
    expect(stored.find((w) => w.id === "notes-1")).toMatchObject({ content: "keep me" });
  });

  it("adds an instance with a new id", async () => {
    const fresh = newInstance("countdown", "countdown-x");
    expect((await put("countdown-x", fresh)).status).toBe(200);
    const { readConfigInternal } = await import("@/lib/config");
    expect((await readConfigInternal()).widgets.map((w) => w.id)).toContain("countdown-x");
  });

  it("rejects a mismatched id, an incomplete instance, and the list's own limits", async () => {
    expect((await put("other", notes)).status).toBe(400);
    expect((await put("notes-1", { id: "notes-1", type: "notes" })).status).toBe(400);
    const res = await put("cal-1", { ...calendar, url: "ftp://nope" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/http/);
  });

  it("deletes an instance and its rows on every board, naming those boards first (#318)", async () => {
    const { replaceWidgets, replaceBoards, readConfigInternal } = await import("@/lib/config");
    const extra = { ...newInstance("notes", "notes-2"), content: "stays" };
    await replaceWidgets([calendar, notes, extra]);
    await replaceBoards([
      { id: "home", name: "Home", visibility: "public", layout: { sections: [{ widget: "notes-1", span: 8, hidden: false }, { widget: "notes-2", span: 8, hidden: false }] } },
      { id: "media", name: "Media", visibility: "public", layout: { sections: [{ widget: "notes-1", span: 8, hidden: false }] } },
      { id: "infra", name: "Infra", visibility: "private", layout: { sections: [{ widget: "notes-1", span: 8, hidden: true }] } },
    ]);
    expect((await (await get("notes-1")).json()).boards).toEqual(["Home", "Media"]);

    expect((await del("notes-1")).status).toBe(204);
    const config = await readConfigInternal();
    expect(config.widgets.map((w) => w.id)).toEqual(["cal-1", "notes-2"]);
    for (const board of config.boards)
      expect(board.layout.sections.map((r) => r.widget), board.id).not.toContain("notes-1");
    expect(config.boards[0].layout.sections.map((r) => r.widget)).toEqual(["notes-2"]);
    expect((await del("notes-1")).status).toBe(404);
  });

  it("asks a stale session to confirm before re-pointing a calendar, not for other edits (#378)", async () => {
    const stale = await adminSession();
    await staleSession(stale);
    const putAs = (body: unknown) =>
      route.PUT(request("/api/widgets/cal-1", { method: "PUT", body, session: stale }), params({ id: "cal-1" }));
    expect((await putAs({ ...calendar, count: 9 })).status).toBe(200);
    const moved = await putAs({ ...calendar, count: 9, url: "https://evil.example/cal" });
    expect(moved.status).toBe(403);
    expect(await moved.json()).toMatchObject({ reauthRequired: true });
    expect((await putAs({ ...calendar, count: 9, username: "you" })).status).toBe(403);
    const { readConfigInternal } = await import("@/lib/config");
    expect((await readConfigInternal()).widgets.find((w) => w.id === "cal-1")).toMatchObject({ url: calendar.url, count: 9 });
  });

  it("lets a list already past the feed-card cap be edited and trimmed, not grown (#426)", async () => {
    const { replaceWidgets, readConfigInternal } = await import("@/lib/config");
    const { MAX_FEED_CARDS } = await import("@/lib/schema");
    // As the 3.0 upgrade leaves a 2.x file with more feed cards than fit:
    // stored whole, never held to the cap.
    const feeds = Array.from({ length: MAX_FEED_CARDS + 2 }, (_, i) => ({
      ...newInstance("feed", `f${i}`),
      urls: ["https://a.example/feed"],
    }));
    await replaceWidgets([notes, ...feeds]);
    // An edit in place saves, and so does a widget of another kind.
    expect((await put("f0", { ...feeds[0], count: 3 })).status).toBe(200);
    expect((await put("notes-9", newInstance("notes", "notes-9"))).status).toBe(200);
    // One more feed card is refused, naming the cap.
    const res = await put("f-more", { ...newInstance("feed", "f-more"), urls: ["https://b.example/feed"] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(`At most ${MAX_FEED_CARDS} RSS feed cards`);
    const stored = (await readConfigInternal()).widgets;
    expect(stored.find((w) => w.id === "f0")).toMatchObject({ count: 3 });
    expect(stored.map((w) => w.id)).not.toContain("f-more");
    // Trimmed by one, the rest still saves.
    expect((await del(`f${MAX_FEED_CARDS + 1}`)).status).toBe(204);
    expect((await put("f1", { ...feeds[1], count: 4 })).status).toBe(200);
  });
});
