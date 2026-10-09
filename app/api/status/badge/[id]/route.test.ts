import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "node:fs/promises";
import * as YAML from "js-yaml";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";
import { checkSignature } from "@/lib/status-check";
import { clearLatestChecks, publishChecks } from "@/lib/status-latest";
import { loadHistory, recordResults } from "@/lib/status-history";
import type { AppItem } from "@/lib/schema";

// Status badges (#295): served from the poller's checks and the history,
// with the status page's visibility rules.
let GET: typeof import("./route").GET;
let session: string;
let configPath: string;
let configured: AppItem[];
const base = {
  settings: { statusChecks: true },
  apps: [
    { id: "pub", name: "Public App", url: "https://pub.example.com", private: false },
    { id: "priv", name: "Private App", url: "https://priv.example.com", private: true },
  ],
};

beforeAll(async () => {
  configPath = await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  await fs.writeFile(configPath, YAML.dump(base), "utf8");
  ({ GET } = await import("./route"));
  configured = (await (await import("@/lib/config")).readConfigInternal()).apps;
  session = await adminSession();
});

beforeEach(async () => {
  clearLatestChecks();
  await fs.writeFile(configPath, YAML.dump(base), "utf8");
});

const badge = (id: string, query = "", auth = false) =>
  GET(request(`/api/status/badge/${id}${query}`, { session: auth ? session : undefined }), {
    params: Promise.resolve({ id }),
  });

function publish(id: string, up: boolean) {
  const a = configured.find((x) => x.id === id)!;
  publishChecks([{ result: { id, up, status: up ? 200 : 503, ms: 20 }, at: Date.now(), signature: checkSignature(a) }], [id]);
}

describe("GET /api/status/badge/[id]", () => {
  it("shows the live state from the poller's check, with or without .svg", async () => {
    publish("pub", true);
    const res = await badge("pub.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(await res.text()).toContain('aria-label="Public App: up"');
    publish("pub", false);
    expect(await (await badge("pub")).text()).toContain('aria-label="Public App: down"');
  });

  it("says unknown before the poller has checked", async () => {
    expect(await (await badge("pub.svg")).text()).toContain(": unknown");
  });

  it("404s a private app to a guest, and serves it privately to the admin", async () => {
    publish("priv", true);
    expect((await badge("priv.svg")).status).toBe(404);
    const res = await badge("priv.svg", "", true);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("404s unknown apps and everything while checks are off", async () => {
    expect((await badge("nope.svg")).status).toBe(404);
    await fs.writeFile(configPath, YAML.dump({ ...base, settings: { statusChecks: false } }), "utf8");
    expect((await badge("pub.svg")).status).toBe(404);
  });

  it("shows uptime and response time over a range, and a custom label", async () => {
    await loadHistory();
    const t = Date.now() - 10 * 60_000;
    recordResults([{ id: "pub", up: true, status: 200, ms: 120 }], t);
    recordResults([{ id: "pub", up: false, status: 503, ms: 5000 }], t + 60_000);
    expect(await (await badge("pub.svg", "?type=uptime&range=24h")).text()).toContain(
      'aria-label="uptime 24h: 50.00%"'
    );
    expect(await (await badge("pub.svg", "?type=response&range=d1&label=ping")).text()).toContain(
      'aria-label="ping: 120 ms"'
    );
  });

  it("says maintenance for a down app inside a maintenance window (#293)", async () => {
    await fs.writeFile(
      configPath,
      YAML.dump({
        ...base,
        settings: {
          statusChecks: true,
          statusAnnouncements: [{ id: "m", kind: "maintenance", title: "Work", apps: ["pub"] }],
        },
      }),
      "utf8"
    );
    publish("pub", false);
    expect(await (await badge("pub.svg")).text()).toContain(": maintenance");
  });
});
