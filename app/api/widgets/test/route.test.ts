import { describe, it, expect, beforeAll, vi } from "vitest";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";
import { newInstance } from "@/lib/schema";

// An API widget's "Test" (#302): header references only reach the widget's
// own saved URL, and the answer carries the raw response beside the view.
let route: typeof import("./route");
let session: string;

const saved = {
  ...newInstance("api", "api-1"),
  url: "http://saved.lan/stats",
  headers: [{ name: "Authorization", value: "Bearer ${API_TOKEN}" }],
  fields: [{ label: "Users", path: "$.users", unit: "" }],
};

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  route = await import("./route");
  session = await adminSession();
  const { replaceWidgets } = await import("@/lib/config");
  await replaceWidgets([saved]);
});

const test = (widget: unknown, auth = true) =>
  route.POST(request("/api/widgets/test", { method: "POST", body: { widget }, session: auth ? session : undefined }));

// The Authorization header each request sent, read off the stubbed fetch.
function stubFetch(body: unknown = { users: 42 }) {
  const sent: (string | null)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Headers(init?.headers).get("Authorization"));
      return Response.json(body);
    })
  );
  return sent;
}

describe("POST /api/widgets/test", () => {
  it("requires a session, and an API widget", async () => {
    expect((await test(saved, false)).status).toBe(401);
    expect((await test(newInstance("notes", "n"))).status).toBe(400);
  });

  it("answers with the raw response and the mapped view", async () => {
    vi.stubEnv("API_TOKEN", "t0k");
    const sent = stubFetch();
    const res = await test({ ...saved, url: "http://saved.lan/stats/" });
    const out = await res.json();
    expect(sent[0]).toBe("Bearer t0k");
    expect(out.ok).toBe(true);
    expect(out.raw).toContain('"users": 42');
    expect(out.view).toMatchObject({ display: "stat", value: "42" });
  });

  it("expands nothing for a typed URL, or another widget's", async () => {
    vi.stubEnv("API_TOKEN", "t0k");
    let sent = stubFetch();
    await test({ ...saved, url: "http://evil.example/" });
    expect(sent[0]).toBe("Bearer");
    sent = stubFetch();
    await test({ ...saved, id: "api-2" });
    expect(sent[0]).toBe("Bearer");
  });

  it("reports a path that doesn't map, with the raw response", async () => {
    stubFetch({ other: 1 });
    const out = await (await test({ ...saved, fields: [{ label: "x", path: "a[", unit: "" }] })).json();
    expect(out.ok).toBe(false);
    expect(out.raw).toContain("other");
    expect(out.error).toBeTruthy();
  });
});
