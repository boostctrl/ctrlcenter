import { afterEach, describe, expect, it, vi } from "vitest";

// Board tiles for integrations (#301). The security property: a tile set to
// "Everyone" is built only from counts and states, so nothing identifying in
// a service's snapshot — names, titles, hosts, users, domains, messages —
// ever reaches a public board.
const { getMonitorSnapshot } = vi.hoisted(() => ({ getMonitorSnapshot: vi.fn() }));
vi.mock("../monitor", () => ({ getMonitorSnapshot }));

import { PUBLIC_GLANCES, GLANCES, tileContent } from "@/components/monitor/glances";
import { integrationTiles, shownToGuests } from "./integration-tiles";
import { integrationSchema, newInstance, type InstanceOf } from "../schema";
import { SERVICE_IDS, type ServiceId } from "../services/ids";

const NOW = Date.UTC(2026, 9, 10, 12);
const L = (what: string) => `LEAK-${what}`;

// A snapshot per type with every free-text field holding a marker.
const SNAPSHOTS: Record<ServiceId, unknown> = {
  qbittorrent: {
    downSpeed: 1000,
    upSpeed: 500,
    counts: { total: 3, downloading: 1, seeding: 1, paused: 1, errored: 0 },
    torrents: [{ name: L("torrent"), state: "downloading", progress: 0.5, eta: 60, hash: L("hash") }],
  },
  sonarr: {
    upcoming: [{ title: L("series"), subtitle: L("episode"), at: NOW + 3600_000 }],
    recent: [{ title: L("recent"), subtitle: L("sub"), event: "grabbed", at: NOW - 3600_000 }],
    health: [{ type: "error", message: L("health") }],
  },
  radarr: {
    upcoming: [{ title: L("movie"), subtitle: L("kind"), at: NOW + 3600_000 }],
    recent: [],
    health: [{ type: "warning", message: L("health") }],
  },
  adguard: {
    protectionEnabled: true,
    totalQueries: 12000,
    blocked: 1200,
    blockedRatio: 0.1,
    avgProcessingMs: null,
    windowLabel: L("window"),
    series: [1, 2, 3],
    blockedSeries: [0, 1, 0],
    topBlocked: [{ domain: L("domain.example"), count: 4 }],
  },
  tautulli: {
    streamCount: 2,
    transcodeCount: 1,
    totalBandwidthKbps: 8000,
    sessions: [{ title: L("title"), user: L("user"), state: "playing", progress: 0.2 }],
  },
  seerr: {
    pending: 1,
    processing: 2,
    available: 3,
    totalRequests: 6,
    requests: [{ id: 1, title: L("request"), requester: L("requester"), status: "processing" }],
  },
  portainer: {
    endpoints: [{ id: 1, name: L("endpoint"), running: 3, stopped: 1, unhealthy: 0, total: 4 }],
    totals: { running: 3, stopped: 1, unhealthy: 0, total: 4 },
  },
  truenas: {
    pools: [{ name: L("pool"), status: "ONLINE", healthy: true, usedRatio: 0.5, free: 1e12 }],
    apps: [{ name: L("app"), running: true, upgradeAvailable: false, containers: 2 }],
    alerts: [{ level: "critical", message: L("alert") }],
  },
  unifi: {
    internet: { up: true, isp: L("isp"), wanIp: L("wan-ip"), latencyMs: 12 },
    clients: { total: 10, wireless: 7, wired: 3, guests: 1 },
    devices: { adopted: 4, disconnected: 1, pending: 0 },
    issues: [{ level: "warning", message: L("issue") }],
  },
};

afterEach(() => vi.clearAllMocks());

describe("public views", () => {
  it.each(SERVICE_IDS)("%s shows counts and states, nothing identifying", (type) => {
    const view = (PUBLIC_GLANCES[type] as (d: unknown, now: number) => unknown)(SNAPSHOTS[type], NOW);
    expect(JSON.stringify(view)).not.toContain("LEAK");
  });

  it("the admin glances do carry the details (so the fixtures exercise the fields)", () => {
    const leaky = SERVICE_IDS.filter((type) =>
      JSON.stringify((GLANCES[type] as (d: unknown, now: number) => unknown)(SNAPSHOTS[type], NOW)).includes("LEAK")
    );
    expect(leaky.length).toBeGreaterThan(4);
  });

  it("an offline tile tells the public nothing about why", () => {
    const entry = {
      id: "s",
      type: "sonarr" as const,
      label: "Sonarr",
      configured: true,
      enabled: true,
      urlSet: true,
      actionsAllowed: false,
      data: null,
      error: L("http://10.0.0.5 refused"),
      at: null,
    };
    expect(JSON.stringify(tileContent(entry, NOW, "public"))).not.toContain("LEAK");
    expect(JSON.stringify(tileContent(entry, NOW, "admin"))).toContain("LEAK");
  });
});

describe("integrationTiles", () => {
  const sonarr = integrationSchema.parse({ id: "sonarr", type: "sonarr", url: "http://s", apiKey: "k" });
  const qbit = integrationSchema.parse({ id: "qb", type: "qbittorrent", url: "http://q" });
  const tile = (id: string, integration: string, visibility: "admin" | "public"): InstanceOf<"integration"> => ({
    ...newInstance("integration", id),
    integration,
    visibility,
  });
  const entry = (i: typeof sonarr) => ({
    id: i.id,
    type: i.type,
    label: "x",
    configured: true,
    enabled: true,
    urlSet: true,
    actionsAllowed: false,
    data: SNAPSHOTS[i.type],
    error: null,
    at: NOW,
  });

  it("gives a guest only the public tiles, as public views without links", async () => {
    getMonitorSnapshot.mockImplementation(async (list: (typeof sonarr)[]) => list.map(entry));
    const out = await integrationTiles(
      [tile("pub", "sonarr", "public"), tile("priv", "qb", "admin")],
      [sonarr, qbit],
      { isAdmin: false, now: NOW }
    );
    expect(Object.keys(out)).toEqual(["pub"]);
    expect(out.pub.href).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("LEAK");
    // The admin-only integration was never even polled for the guest.
    expect(getMonitorSnapshot.mock.calls[0][0].map((i: { id: string }) => i.id)).toEqual(["sonarr"]);
  });

  it("gives the admin both, the private one in full with its Monitor link", async () => {
    getMonitorSnapshot.mockImplementation(async (list: (typeof sonarr)[]) => list.map(entry));
    const out = await integrationTiles(
      [tile("pub", "sonarr", "public"), tile("priv", "qb", "admin")],
      [sonarr, qbit],
      { isAdmin: true, now: NOW }
    );
    expect(out.priv).toMatchObject({ label: "qBittorrent", href: "/admin/monitor/qb", state: "live" });
    expect(JSON.stringify(out.priv)).toContain("LEAK");
    // A public tile reads the same for the admin as for visitors.
    expect(JSON.stringify(out.pub)).not.toContain("LEAK");
  });

  it("skips a tile with no integration picked, or a gone one, without polling", async () => {
    const out = await integrationTiles([tile("a", "", "public"), tile("b", "gone", "public")], [sonarr], {
      isAdmin: true,
      now: NOW,
    });
    expect(out).toEqual({});
    expect(getMonitorSnapshot).not.toHaveBeenCalled();
  });

  it("knows which tiles a guest may receive", () => {
    expect(shownToGuests(tile("a", "s", "public"))).toBe(true);
    expect(shownToGuests(tile("a", "s", "admin"))).toBe(false);
  });
});
