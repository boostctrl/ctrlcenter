import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTruenasSnapshot,
  probeTruenas,
  mapTruenasPools,
  mapTruenasApps,
  mapTruenasAlerts,
  TRUENAS_ALERT_CAP,
  TRUENAS_APP_CAP,
  mapTruenasSystem,
  mapTruenasPoolDetail,
  mapTruenasDisks,
  REVOKED_OVER_HTTP,
} from "./truenas";

const CFG = { url: "http://truenas.local/", apiKey: "1-abcdef" };

const POOLS = [
  {
    name: "tank",
    status: "ONLINE",
    healthy: true,
    size: "8000000000000",
    allocated: "2000000000000",
    free: "6000000000000",
  },
  {
    name: "backup",
    status: "DEGRADED",
    healthy: false,
    size: 4000000000000,
    allocated: 3800000000000,
    free: 200000000000,
  },
];

const ALERTS = [
  { uuid: "a1b2", level: "CRITICAL", formatted: "Pool backup is DEGRADED", dismissed: false },
  { id: 7, level: "WARNING", formatted: "SMART: disk sda has 1 bad sector", dismissed: false },
  { level: "INFO", formatted: "Scrub finished", dismissed: false },
  { level: "CRITICAL", formatted: "Old dismissed alert", dismissed: true },
];

const APPS = [
  { name: "jellyfin", state: "RUNNING", upgrade_available: false, active_workloads: { containers: 1 } },
  { name: "sonarr", state: "STOPPED", upgrade_available: true, active_workloads: { containers: 0 } },
  {
    name: "immich",
    state: "CRASHED",
    upgrade_available: false,
    active_workloads: {
      container_details: [
        { service_name: "immich_server", image: "ghcr.io/immich/server:v1.100", state: "exited" },
        { service_name: "immich_redis", image: "redis:7", state: "running" },
        { id: "abc123", state: "running" },
      ],
    },
  },
];

function stubApi(opts: {
  pools?: unknown;
  apps?: unknown;
  alerts?: unknown;
  info?: unknown;
  fail?: (url: string) => number | null;
}) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    const failStatus = opts.fail?.(url) ?? null;
    if (failStatus) return new Response("nope", { status: failStatus });
    if (url.includes("/api/v2.0/pool")) {
      return new Response(JSON.stringify(opts.pools ?? POOLS));
    }
    if (url.includes("/api/v2.0/app")) {
      return new Response(JSON.stringify(opts.apps ?? APPS));
    }
    if (url.includes("/api/v2.0/alert/list")) {
      return new Response(JSON.stringify(opts.alerts ?? ALERTS));
    }
    if (url.includes("/api/v2.0/system/info")) {
      return new Response(JSON.stringify(opts.info ?? { version: "TrueNAS-SCALE-24.04" }));
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getTruenasSnapshot", () => {
  it("maps pools and active alerts", async () => {
    const fetchMock = stubApi({});
    const snap = await getTruenasSnapshot(CFG);
    expect(snap.pools).toEqual([
      { name: "tank", status: "ONLINE", healthy: true, usedRatio: 0.25, free: 6000000000000 },
      { name: "backup", status: "DEGRADED", healthy: false, usedRatio: 0.95, free: 200000000000 },
    ]);
    // Each by TrueNAS's own id: its uuid, else its id (#540).
    expect(snap.alerts).toEqual([
      { id: "a1b2", level: "critical", message: "Pool backup is DEGRADED" },
      { id: "7", level: "warning", message: "SMART: disk sda has 1 bad sector" },
    ]);
    expect(snap.unread).toBeUndefined();
    // The API key rides a Bearer header.
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe("Bearer 1-abcdef");
  });

  it("shows pools even when the alert list fails", async () => {
    stubApi({ fail: (url) => (url.includes("/alert/list") ? 500 : null) });
    const snap = await getTruenasSnapshot(CFG);
    expect(snap.pools).toHaveLength(2);
    expect(snap.alerts).toEqual([]);
    // An empty list that wasn't read isn't every alert resolved (#540).
    expect(snap.unread).toEqual(["alerts"]);
  });

  it("maps apps with not-running ones first", async () => {
    stubApi({});
    const snap = await getTruenasSnapshot(CFG);
    expect(snap.apps).toEqual([
      { name: "sonarr", state: "STOPPED", running: false, upgradeAvailable: true, containers: 0, containerList: [] },
      {
        name: "immich",
        state: "CRASHED",
        running: false,
        upgradeAvailable: false,
        containers: 3,
        containerList: [
          { name: "immich_server", state: "exited", image: "ghcr.io/immich/server:v1.100" },
          { name: "immich_redis", state: "running", image: "redis:7" },
          { name: "abc123", state: "running", image: null },
        ],
      },
      { name: "jellyfin", state: "RUNNING", running: true, upgradeAvailable: false, containers: 1, containerList: [] },
    ]);
  });

  it("returns the full app roster even when the response exceeds the default cap", async () => {
    // Each TrueNAS app object is large; a big roster's body runs past the
    // default 4 MB cap. That must NOT fail the whole fetch — the regression was
    // that a host with many apps showed none (or was truncated).
    const filler = "x".repeat(150 * 1024);
    const bigApps = Array.from({ length: 30 }, (_, i) => ({
      name: `app${i}`,
      state: "RUNNING",
      config: filler,
      active_workloads: {
        container_details: [{ service_name: `svc${i}`, image: "img:1", state: "running" }],
      },
    }));
    const fetchMock = stubApi({ apps: bigApps });
    const snap = await getTruenasSnapshot(CFG);
    expect(snap.apps).toHaveLength(30);
    // The app query carries an explicit limit so an upstream default page size
    // can't silently truncate the roster.
    const appUrl = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/api/v2.0/app"));
    expect(appUrl).toContain("limit=");
  });

  it("shows pools even when the apps list fails (older SCALE without /app)", async () => {
    stubApi({ fail: (url) => (url.includes("/api/v2.0/app") ? 404 : null) });
    const snap = await getTruenasSnapshot(CFG);
    expect(snap.pools).toHaveLength(2);
    expect(snap.apps).toEqual([]);
    expect(snap.unread).toEqual(["apps"]);
  });

  it("maps a 401 on the pool list to an invalid-key message", async () => {
    stubApi({ fail: (url) => (url.includes("/api/v2.0/pool") ? 401 : null) });
    await expect(getTruenasSnapshot({ ...CFG, url: "https://truenas.local/" })).rejects.toThrow(/^Invalid API key$/);
  });

  it("says a key refused over plain http may have been revoked for it (#560)", async () => {
    stubApi({ fail: (url) => (url.includes("/api/v2.0/pool") ? 401 : null) });
    await expect(getTruenasSnapshot(CFG)).rejects.toThrow(REVOKED_OVER_HTTP);
    stubApi({ fail: () => 403 });
    expect(await probeTruenas(CFG)).toEqual({ ok: false, error: REVOKED_OVER_HTTP });
    expect(await probeTruenas({ ...CFG, url: "https://truenas.local" })).toEqual({ ok: false, error: "Invalid API key" });
  });
});

describe("mapTruenasPools", () => {
  it("leaves usedRatio null when sizes are missing and marks non-ONLINE unhealthy", () => {
    const pools = mapTruenasPools([{ name: "p", status: "ONLINE", healthy: true }]);
    expect(pools[0].usedRatio).toBeNull();
    expect(pools[0].free).toBeNull();
    // healthy=true but a FAULTED status must still read unhealthy.
    const faulted = mapTruenasPools([{ name: "p", status: "FAULTED", healthy: true }]);
    expect(faulted[0].healthy).toBe(false);
  });
});

describe("mapTruenasApps", () => {
  it("caps the list and treats malformed input as empty", () => {
    const many = Array.from({ length: 65 }, (_, i) => ({ name: `a${i}`, state: "RUNNING" }));
    expect(mapTruenasApps(many)).toHaveLength(TRUENAS_APP_CAP);
    expect(mapTruenasApps("nonsense")).toEqual([]);
    expect(mapTruenasApps([])).toEqual([]);
  });

  it("normalizes state, containers, and the upgrade flag", () => {
    const [app] = mapTruenasApps([
      { name: "  vaultwarden  ", state: "deploying", upgrade_available: true },
    ]);
    expect(app).toEqual({
      name: "vaultwarden",
      state: "DEPLOYING",
      running: false,
      upgradeAvailable: true,
      containers: null,
      containerList: [],
    });
  });

  it("lists containers from active_workloads, capping and falling back for names", () => {
    const [app] = mapTruenasApps([
      {
        name: "app",
        state: "RUNNING",
        active_workloads: {
          container_details: [
            { service_name: "web", image: "nginx", state: "RUNNING" },
            { id: "onlyid" },
            ...Array.from({ length: 30 }, () => ({ service_name: "x" })),
          ],
        },
      },
    ]);
    expect(app.containerList).toHaveLength(20);
    expect(app.containerList[0]).toEqual({ name: "web", state: "running", image: "nginx" });
    // Missing service_name falls back to the id; missing state reads "unknown".
    expect(app.containerList[1]).toEqual({ name: "onlyid", state: "unknown", image: null });
    // The count comes from the detailed list when TrueNAS omits the number.
    expect(app.containers).toBe(20);
  });
});

describe("mapTruenasAlerts", () => {
  it("drops dismissed/INFO and caps the list", () => {
    const many = Array.from({ length: TRUENAS_ALERT_CAP + 5 }, (_, i) => ({
      level: "WARNING",
      formatted: `w${i}`,
    }));
    expect(mapTruenasAlerts(many)).toHaveLength(TRUENAS_ALERT_CAP);
    // Without an id of its own, an alert goes by its message.
    expect(mapTruenasAlerts(many)[3].id).toBe("w3");
    expect(mapTruenasAlerts([{ level: "INFO", formatted: "x" }])).toEqual([]);
  });
});

describe("probeTruenas", () => {
  it("names the version that answered", async () => {
    stubApi({});
    expect(await probeTruenas(CFG)).toEqual({
      ok: true,
      detail: "TrueNAS TrueNAS-SCALE-24.04",
    });
  });

  it("folds an unreachable service into the result shape", async () => {
    stubApi({ fail: () => 502 });
    expect(await probeTruenas(CFG)).toEqual({ ok: false, error: "HTTP 502" });
  });
});

describe("the TrueNAS detail's extras (#528)", () => {
  const pools = [
    {
      name: "tank",
      size: 100,
      allocated: 60,
      scan: { function: "SCRUB", state: "FINISHED", end_time: { $date: 1_700_000_000_000 }, errors: 0 },
      topology: { data: [{ type: "MIRROR", children: [{ type: "DISK", disk: "sda" }, { type: "DISK", disk: "sdb" }] }], cache: [] },
    },
    { name: "fast", size: "50", allocated: "10", scan: { function: "RESILVER", state: "SCANNING", end_time: null, errors: 2 } },
    { name: "cold" },
  ];

  it("reads the system, and each pool's size and last scrub", () => {
    expect(mapTruenasSystem({ version: "TrueNAS-SCALE-25.04.1", hostname: "nas", uptime_seconds: 90, cores: 8, physmem: 64, loadavg: [1, 2, 3] })).toEqual({
      version: "TrueNAS-SCALE-25.04.1",
      hostname: "nas",
      model: "",
      uptimeSeconds: 90,
      cores: 8,
      memory: 64,
      load: [1, 2, 3],
    });
    expect(mapTruenasSystem(null)).toBeNull();
    expect(mapTruenasPoolDetail(pools)).toEqual([
      { name: "tank", size: 100, used: 60, scan: { kind: "scrub", state: "finished", at: 1_700_000_000_000, errors: 0 } },
      { name: "fast", size: 50, used: 10, scan: { kind: "resilver", state: "scanning", at: null, errors: 2 } },
      { name: "cold", size: null, used: null, scan: null },
    ]);
  });

  it("puts each disk in its pool with its temperature, hottest first", () => {
    const disks = mapTruenasDisks(
      [
        { name: "sda", model: "WD Red", size: 8, type: "HDD" },
        { name: "sdb", model: "WD Red", size: 8, type: "HDD" },
        { name: "nvme0n1", model: "990 PRO", size: 2, type: "SSD", pool: "fast" },
        { name: "sdz", type: "weird" },
        { model: "no name" },
      ],
      pools,
      { sda: 38, sdb: 51.6, nvme0n1: 0 }
    );
    expect(disks.map((d) => [d.name, d.pool, d.temperature, d.kind])).toEqual([
      ["sdb", "tank", 52, "HDD"],
      ["sda", "tank", 38, "HDD"],
      ["nvme0n1", "fast", null, "SSD"],
      ["sdz", null, null, ""],
    ]);
  });
});
