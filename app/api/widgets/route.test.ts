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
