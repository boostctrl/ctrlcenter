import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "node:fs/promises";
import * as YAML from "js-yaml";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";
import { loadHistory, recordResults, setOutageNote } from "@/lib/status-history";

// The incidents feed (#295): outages with notes and announcements, with the
// status page's visibility.
let GET: typeof import("./route").GET;
let session: string;
let configPath: string;
const MIN = 60_000;
const t0 = Date.now() - 60 * MIN;
const config = (statusChecks: boolean) => ({
  settings: {
    title: "Home",
    statusChecks,
    statusAnnouncements: [{ id: "a", kind: "info", title: "Hello & welcome", body: "Hi" }],
  },
  apps: [
    { id: "pub", name: "Public App", url: "https://pub.example.com", private: false },
    { id: "priv", name: "Private App", url: "https://priv.example.com", private: true },
  ],
});

beforeAll(async () => {
  configPath = await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  await fs.writeFile(configPath, YAML.dump(config(true)), "utf8");
  ({ GET } = await import("./route"));
  session = await adminSession();
  await loadHistory();
  for (const id of ["pub", "priv"]) {
    recordResults([{ id, up: false, status: 503, ms: 5000 }], t0);
    recordResults([{ id, up: true, status: 200, ms: 10 }], t0 + 7 * MIN);
  }
  setOutageNote("pub", t0, "Router reboot");
});

describe("GET /status/feed.xml", () => {
  it("lists public outages with their notes, plus announcements, for a guest", async () => {
    const res = await GET(request("/status/feed.xml"));
    expect(res.headers.get("content-type")).toContain("application/atom+xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const xml = await res.text();
    expect(xml).toContain("<title>Home status</title>");
    expect(xml).toContain("<title>Public App was down for 7m</title>");
    expect(xml).toContain("Note: Router reboot");
    expect(xml).toContain("<title>Notice: Hello &amp; welcome</title>");
    expect(xml).not.toContain("Private App");
  });

  it("includes private apps for the admin, never cached", async () => {
    const res = await GET(request("/status/feed.xml", { session }));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).toContain("Private App was down");
  });

  it("carries only announcements while status checks are off", async () => {
    await fs.writeFile(configPath, YAML.dump(config(false)), "utf8");
    try {
      const xml = await (await GET(request("/status/feed.xml"))).text();
      expect(xml).not.toContain("was down");
      expect(xml).toContain("Hello &amp; welcome");
    } finally {
      await fs.writeFile(configPath, YAML.dump(config(true)), "utf8");
    }
  });
});
