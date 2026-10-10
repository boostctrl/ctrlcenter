import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "node:fs/promises";
import * as YAML from "js-yaml";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";

// The action guard (#289): every gate before a dashboard action reaches a
// service. No test here gets as far as the network.
let POST: typeof import("./route").POST;
let configPath: string;
let session: string;

async function writeIntegrations(qbittorrent: Record<string, unknown>) {
  await fs.writeFile(
    configPath,
    YAML.dump({ settings: { integrations: { qbittorrent } } }),
    "utf8"
  );
}

const act = (body: unknown, auth = true) =>
  POST(request("/api/monitor/action", { method: "POST", body, session: auth ? session : undefined }));

// A 2.x-shaped config migrates the qBittorrent key to an integration with id
// "qbittorrent" (#300).
const pause = { integration: "qbittorrent", service: "qbittorrent", action: "pause", hash: "abc" };

beforeAll(async () => {
  configPath = await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  ({ POST } = await import("./route"));
  session = await adminSession();
});

describe("POST /api/monitor/action", () => {
  it("requires a session", async () => {
    await writeIntegrations({ enabled: true, url: "http://qb.lan", allowActions: true });
    expect((await act(pause, false)).status).toBe(401);
  });

  it("rejects an unknown action", async () => {
    expect((await act({ ...pause, action: "format-disk" })).status).toBe(400);
    expect((await act({ service: "qbittorrent", action: "pause", hash: "x" })).status).toBe(400);
  });

  it("refuses an integration that isn't configured (409)", async () => {
    await writeIntegrations({ enabled: false });
    expect((await act(pause)).status).toBe(409);
  });

  it("refuses actions until the admin opts in (403)", async () => {
    await writeIntegrations({ enabled: true, url: "http://qb.lan", allowActions: false });
    const res = await act(pause);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not enabled/);
  });
});
