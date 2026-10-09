import { describe, it, expect, beforeAll, vi } from "vitest";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";

// Undo-delete restore (#307, #289).
let restore: typeof import("./route");
let apps: typeof import("../route");
let session: string;

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  restore = await import("./route");
  apps = await import("../route");
  session = await adminSession();
});

const app = (id: string, name: string) => ({
  id,
  name,
  subtitle: "",
  url: `https://${name}.example.com`,
  icon: "",
  expectStatus: "",
  checkType: "http",
  keyword: "",
  private: false,
});

describe("POST /api/apps/restore", () => {
  it("requires a session", async () => {
    const res = await restore.POST(
      request("/api/apps/restore", { method: "POST", body: { item: app("x", "x"), index: 0 } })
    );
    expect(res.status).toBe(401);
  });

  it("validates the body", async () => {
    const res = await restore.POST(
      request("/api/apps/restore", { method: "POST", body: { item: {}, index: -1 }, session })
    );
    expect(res.status).toBe(400);
  });

  it("puts the app back with its id, at its index, once", async () => {
    for (const name of ["a", "c"]) {
      await apps.POST(
        request("/api/apps", { method: "POST", body: { name, url: `https://${name}.example.com` }, session })
      );
    }
    const body = { item: app("kept-id", "b"), index: 1 };
    await restore.POST(request("/api/apps/restore", { method: "POST", body, session }));
    const res = await restore.POST(request("/api/apps/restore", { method: "POST", body, session }));
    const list = (await res.json()) as { id: string; name: string }[];
    expect(list.map((a) => a.name)).toEqual(["a", "b", "c"]);
    expect(list[1].id).toBe("kept-id");
  });
});
