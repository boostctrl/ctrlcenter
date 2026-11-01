import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import * as YAML from "js-yaml";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";
import {
  getAppDetail,
  loadHistory,
  recordResults,
  setOutageNote,
} from "@/lib/status-history";

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

  it("leaves secrets out of the export unless asked (#366)", async () => {
    await fs.writeFile(
      configPath,
      YAML.dump({
        settings: { title: "Before" },
        integrations: [
          { id: "qb", type: "qbittorrent", url: "http://qb", username: "admin", password: "hunter2" },
          { id: "sonarr", type: "sonarr", url: "http://s", apiKey: "${SONARR_KEY}" },
        ],
        apps: [{ id: "nas", name: "NAS", url: "http://nas", checkMethod: "push", pushToken: "tok-123" }],
        // A calendar's secret address is a credential too (#380).
        widgets: [{ id: "cal", type: "calendar", url: "https://cal.test/private-abc/basic.ics" }],
      }),
      "utf8"
    );
    const plain = await (await route.GET(request("/api/config", { session }))).json();
    expect(plain.integrations.map((i: { id: string; url: string; password: string; apiKey: string }) => [i.id, i.url, i.password, i.apiKey])).toEqual([
      ["qb", "http://qb", "", ""],
      // An environment reference names no secret, so it stays.
      ["sonarr", "http://s", "", "${SONARR_KEY}"],
    ]);
    expect(plain.apps[0].pushToken).toBe("");
    expect(plain.widgets.find((w: { id: string }) => w.id === "cal").url).toBe("");
    expect(JSON.stringify(plain)).not.toContain("hunter2");
    expect(JSON.stringify(plain)).not.toContain("private-abc");

    const full = await (await route.GET(request("/api/config?secrets=1", { session }))).json();
    expect(full.integrations[0].password).toBe("hunter2");
    expect(full.apps[0].pushToken).toBe("tok-123");
    expect(full.widgets.find((w: { id: string }) => w.id === "cal").url).toBe("https://cal.test/private-abc/basic.ics");

    // Restoring the secret-less file keeps what the instance holds.
    plain.settings.title = "Restored";
    expect((await importConfig(plain)).status).toBe(200);
    const onDisk = YAML.load(await fs.readFile(configPath, "utf8")) as {
      settings: { title: string };
      integrations: { id: string; password: string; apiKey: string }[];
      apps: { pushToken: string }[];
      widgets: { id: string; url?: string }[];
    };
    expect(onDisk.settings.title).toBe("Restored");
    expect(onDisk.integrations[0].password).toBe("hunter2");
    expect(onDisk.integrations[1].apiKey).toBe("${SONARR_KEY}");
    expect(onDisk.apps[0].pushToken).toBe("tok-123");
    expect(onDisk.widgets.find((w) => w.id === "cal")?.url).toBe("https://cal.test/private-abc/basic.ics");
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

  it("imports a 2.13 backup, upgrading it on the way", async () => {
    const fixture = path.join(process.cwd(), "lib", "__fixtures__", "config-2.13.yaml");
    const res = await importConfig(YAML.load(await fs.readFile(fixture, "utf8")));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schemaVersion).toBe(3);
    expect(body.groups.length).toBeGreaterThan(0);
    expect(body.widgets.length).toBeGreaterThan(0);
  });

  it("names a row it would otherwise lose instead of importing without it (#403)", async () => {
    const integration = { id: "Sonarr 4K", type: "sonarr", url: "http://sonarr:8989", apiKey: "k" };
    const res = await importConfig({ settings: {}, integrations: [integration] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/integration "Sonarr 4K"/);
    expect(await fs.readFile(configPath, "utf8")).toContain("Before");

    const widget = await importConfig({ settings: {}, widgets: [{ id: "notes", type: "notes" }, { id: "n2", type: "sticky" }] });
    expect(widget.status).toBe(400);
    expect((await widget.json()).error).toMatch(/widget "n2"/);

    const twice = await importConfig({ settings: {}, groups: [{ id: "dev", name: "Dev" }, { id: "dev", name: "Dev 2" }] });
    expect(twice.status).toBe(400);
    expect((await twice.json()).error).toMatch(/group "dev".*Duplicate/);
  });

  it("refuses a list past a cap instead of storing one no save would take (#403)", async () => {
    const feeds = Array.from({ length: 9 }, (_, n) => ({ id: `feed-${n}`, type: "feed", urls: ["https://x.test/rss"] }));
    const res = await importConfig({ settings: {}, widgets: feeds });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/At most 8 RSS feed cards/);
    expect(await fs.readFile(configPath, "utf8")).toContain("Before");

    const many = Array.from({ length: 65 }, (_, n) => ({ id: `note-${n}`, type: "notes" }));
    const big = await importConfig({ settings: {}, widgets: many });
    expect(big.status).toBe(400);
    expect((await big.json()).error).toMatch(/65 widgets; CtrlCenter holds at most 64/);

    // Within every cap, a full 3.0 file imports as it did.
    const ok = await importConfig({
      settings: {},
      boards: [
        {
          id: "home",
          name: "Home",
          visibility: "public",
          icon: "mdi:home",
          theme: "Aurora",
          layout: { sections: [{ widget: "feed-0", span: 12, hidden: false, space: { top: 2 } }, { widget: "api" }] },
        },
      ],
      widgets: [
        ...feeds.slice(0, 8),
        { id: "api", type: "api", url: "https://api.test/v1", fields: [{ label: "Up", path: "$.up" }], thresholds: { warn: 1 } },
        { id: "tile", type: "integration", integration: "sonarr", visibility: "public" },
      ],
      groups: [{ id: "dev", name: "Dev", color: "sky" }],
      integrations: [{ id: "sonarr", type: "sonarr", url: "http://sonarr:8989", apiKey: "k" }],
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.widgets.map((w: { id: string }) => w.id)).toContain("tile");
    expect(body.boards[0].layout.sections).toHaveLength(2);
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

  describe("incident notes (#309)", () => {
    const MIN = 60_000;
    const outage = async (app: string, start: number) => {
      await loadHistory();
      recordResults([{ id: app, up: false, status: 503, ms: 5000 }], start);
      recordResults([{ id: app, up: true, status: 200, ms: 10 }], start + 5 * MIN);
    };
    const exported = async () =>
      (await (await route.GET(request("/api/config", { session }))).json()) as {
        outageNotes?: { app: string; start: number; end: number; note: string }[];
      };

    it("exports only the outages that carry a note, and restores them on import", async () => {
      const t0 = Date.now() - 60 * MIN;
      await outage("nas", t0);
      await outage("nas", t0 + 20 * MIN);
      setOutageNote("nas", t0, "Disk swap");
      const body = await exported();
      expect(body.outageNotes).toEqual([
        { app: "nas", start: t0, end: t0 + 5 * MIN, note: "Disk swap" },
      ]);
      setOutageNote("nas", t0, "");
      expect((await importConfig(body)).status).toBe(200);
      expect(getAppDetail("nas").outages.find((o) => o.startMs === t0)?.note).toBe("Disk swap");
    });

    it("recreates the outage a note describes on a host without it", async () => {
      const t0 = Date.now() - 2 * 60 * MIN;
      const res = await importConfig({
        settings: {},
        outageNotes: [{ app: "moved", start: t0, end: t0 + 10 * MIN, note: "ISP outage" }],
      });
      expect(res.status).toBe(200);
      expect(getAppDetail("moved").outages).toEqual([
        expect.objectContaining({ startMs: t0, endMs: t0 + 10 * MIN, note: "ISP outage" }),
      ]);
    });

    it("rejects invalid notes before replacing anything", async () => {
      const res = await importConfig({
        settings: { title: "After" },
        outageNotes: [{ app: "x", start: 10, end: 5, note: "backwards" }],
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/incident notes/);
      expect(await fs.readFile(configPath, "utf8")).toContain("Before");
    });
  });
});
