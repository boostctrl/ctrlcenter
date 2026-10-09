import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "node:fs/promises";
import * as YAML from "js-yaml";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";

// Config export/import (#289), through the real handlers.
let route: typeof import("./route");
let configPath: string;
let session: string;

beforeAll(async () => {
  configPath = await useScratchConfig();
  route = await import("./route");
  session = await adminSession();
});

beforeEach(async () => {
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  await fs.writeFile(configPath, YAML.dump({ settings: { title: "Before" } }), "utf8");
});

const importConfig = (body: unknown, auth = true) =>
  route.POST(
    request("/api/config", { method: "POST", body, session: auth ? session : undefined })
  );

describe("/api/config", () => {
  it("refuses export and import without a session", async () => {
    expect((await route.GET(request("/api/config"))).status).toBe(401);
    expect((await importConfig({ settings: {} }, false)).status).toBe(401);
  });

  it("exports the config without the admin credential", async () => {
    const res = await route.GET(request("/api/config", { session }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.title).toBe("Before");
    expect(body.auth).toBeUndefined();
  });

  it("imports a valid file, replacing the config", async () => {
    const res = await importConfig({ settings: { title: "After" }, apps: [], bookmarks: [] });
    expect(res.status).toBe(200);
    const onDisk = YAML.load(await fs.readFile(configPath, "utf8")) as {
      settings: { title: string };
    };
    expect(onDisk.settings.title).toBe("After");
  });

  it("rejects garbage with a clear 400 and leaves the file alone", async () => {
    const res = await importConfig({ apps: "not a list" });
    expect(res.status).toBe(400);
    expect(await fs.readFile(configPath, "utf8")).toContain("Before");
  });

  it("explains a backup from a newer release (#288)", async () => {
    const res = await importConfig({ schemaVersion: 99, settings: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/newer CtrlCenter/);
    expect(await fs.readFile(configPath, "utf8")).toContain("Before");
  });

  it("refuses a cross-site import even with a valid session (CSRF)", async () => {
    const res = await route.POST(
      request("/api/config", {
        method: "POST",
        body: { settings: {} },
        session,
        headers: { "sec-fetch-site": "cross-site" },
      })
    );
    expect(res.status).toBe(401);
  });
});
