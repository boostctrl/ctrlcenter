import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "node:fs/promises";
import * as YAML from "js-yaml";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";

// The public status endpoint (#289): it must never reveal a private app to a
// signed-out caller. checkApp is stubbed, so nothing touches the network.
vi.mock("@/lib/status-check", async (orig) => ({
  ...(await orig<typeof import("@/lib/status-check")>()),
  checkApp: vi.fn(async () => ({ up: true, status: 200, ms: 12 })),
}));

let GET: typeof import("./route").GET;
let session: string;

const app = (id: string, isPrivate: boolean) => ({
  id,
  name: id,
  url: `https://${id}.example.com`,
  private: isPrivate,
});

beforeAll(async () => {
  const configPath = await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  await fs.writeFile(
    configPath,
    YAML.dump({
      settings: { statusChecks: true },
      apps: [app("public-app", false), app("private-app", true)],
    }),
    "utf8"
  );
  ({ GET } = await import("./route"));
  session = await adminSession();
});

const ids = async (res: Response) =>
  ((await res.json()) as { results: { id: string }[] }).results.map((r) => r.id);

describe("GET /api/status", () => {
  it("shows a signed-out visitor only public apps", async () => {
    const res = await GET(request("/api/status"));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await ids(res)).toEqual(["public-app"]);
  });

  it("shows the admin every app, from the same shared cache", async () => {
    expect(await ids(await GET(request("/api/status", { session })))).toEqual([
      "public-app",
      "private-app",
    ]);
  });
});
