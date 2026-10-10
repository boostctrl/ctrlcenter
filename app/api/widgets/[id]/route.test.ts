import { describe, it, expect, beforeAll, vi } from "vitest";
import { useScratchConfig, request, adminSession, params } from "@/lib/testing/routes";
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

describe("/api/widgets/[id]", () => {
  it("requires a session", async () => {
    expect((await get("cal-1", false)).status).toBe(401);
    expect((await put("cal-1", calendar, false)).status).toBe(401);
  });

  it("answers with the instance as stored, secrets included, and what its editor needs", async () => {
    const res = await get("cal-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.widget).toMatchObject({ username: "me", password: "s3cret" });
    expect(Array.isArray(body.groups)).toBe(true);
    expect(Array.isArray(body.tags)).toBe(true);
    expect(Array.isArray(body.integrations)).toBe(true);
    expect((await get("nope")).status).toBe(404);
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
});
