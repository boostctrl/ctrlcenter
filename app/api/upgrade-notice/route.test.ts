import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";

// Dismissing the "upgraded to 3.0" banner (#306).
let route: typeof import("./route");
let session: string;
let notice: string;

beforeAll(async () => {
  const configPath = await useScratchConfig();
  notice = path.join(path.dirname(configPath), "upgrade-notice.json");
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  route = await import("./route");
  session = await adminSession();
});

describe("DELETE /api/upgrade-notice", () => {
  it("requires a session, then removes the notice", async () => {
    await fs.writeFile(notice, JSON.stringify({ from: 2, to: 3 }), "utf8");
    expect((await route.DELETE(request("/api/upgrade-notice", { method: "DELETE" }))).status).toBe(401);
    await fs.access(notice);
    expect((await route.DELETE(request("/api/upgrade-notice", { method: "DELETE", session }))).status).toBe(200);
    await expect(fs.access(notice)).rejects.toBeTruthy();
  });
});
