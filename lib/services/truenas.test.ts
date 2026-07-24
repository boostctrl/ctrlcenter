import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTruenasSnapshot,
  probeTruenas,
  resolveTruenasApiKey,
  mapTruenasPools,
  mapTruenasApps,
  mapTruenasAlerts,
  TRUENAS_ALERT_CAP,
  TRUENAS_APP_CAP,
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
  { level: "CRITICAL", formatted: "Pool backup is DEGRADED", dismissed: false },
  { level: "WARNING", formatted: "SMART: disk sda has 1 bad sector", dismissed: false },
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
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
    expect(snap.alerts).toEqual([
      { level: "critical", message: "Pool backup is DEGRADED" },
      { level: "warning", message: "SMART: disk sda has 1 bad sector" },
    ]);
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

  it("shows pools even when the apps list fails (older SCALE without /app)", async () => {
    stubApi({ fail: (url) => (url.includes("/api/v2.0/app") ? 404 : null) });
    const snap = await getTruenasSnapshot(CFG);
    expect(snap.pools).toHaveLength(2);
    expect(snap.apps).toEqual([]);
  });

  it("maps a 401 on the pool list to an invalid-key message", async () => {
    stubApi({ fail: (url) => (url.includes("/api/v2.0/pool") ? 401 : null) });
    await expect(getTruenasSnapshot(CFG)).rejects.toThrow("Invalid API key");
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
    const many = Array.from({ length: 45 }, (_, i) => ({ name: `a${i}`, state: "RUNNING" }));
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
    const many = Array.from({ length: 10 }, (_, i) => ({
      level: "WARNING",
      formatted: `w${i}`,
    }));
    expect(mapTruenasAlerts(many)).toHaveLength(TRUENAS_ALERT_CAP);
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

describe("resolveTruenasApiKey", () => {
  it("prefers the env var over the stored key", () => {
    vi.stubEnv("CTRLCENTER_TRUENAS_KEY", "env-key");
    expect(resolveTruenasApiKey({ apiKey: "stored" })).toBe("env-key");
  });

  it("falls back to the stored key when the env var is unset", () => {
    vi.stubEnv("CTRLCENTER_TRUENAS_KEY", "");
    expect(resolveTruenasApiKey({ apiKey: "stored" })).toBe("stored");
  });
});
