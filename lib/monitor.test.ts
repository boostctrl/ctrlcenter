import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMonitorSnapshot } from "./monitor";
import type { IntegrationsConfig } from "./schema";

const TTL = 30_000;

const integrations = (
  over: Partial<IntegrationsConfig> = {}
): IntegrationsConfig => ({
  qbittorrent: { enabled: false, url: "", username: "", password: "" },
  sonarr: { enabled: false, url: "", apiKey: "" },
  radarr: { enabled: false, url: "", apiKey: "" },
  adguard: { enabled: false, url: "", username: "", password: "" },
  tautulli: { enabled: false, url: "", apiKey: "" },
  ...over,
});

// Sonarr is the simplest service to drive end-to-end (no login dance).
const sonarrOn = (url = "http://sonarr.local:8989") =>
  integrations({ sonarr: { enabled: true, url, apiKey: "k" } });

// `upcomingCount` varies the calendar size across cache windows, so the cache
// tests can tell a fresh snapshot from a served one.
function stubSonarr(upcomingCount: () => number, httpStatus: () => number = () => 200) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const status = httpStatus();
    if (status !== 200) return new Response("boom", { status });
    const url = String(input);
    if (url.includes("/api/v3/calendar")) {
      const episodes = Array.from({ length: upcomingCount() }, (_, i) => ({
        airDateUtc: new Date(Date.now() + i * 3_600_000).toISOString(),
        seasonNumber: 1,
        episodeNumber: i + 1,
        series: { title: "Show" },
      }));
      return new Response(JSON.stringify(episodes));
    }
    if (url.includes("/api/v3/history")) {
      return new Response(JSON.stringify({ records: [] }));
    }
    if (url.includes("/api/v3/health")) return new Response(JSON.stringify([]));
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  // The cache lives on globalThis and survives across tests in a run.
  const g = globalThis as {
    __ctrlcenterMonitorCache?: Map<string, unknown>;
    __ctrlcenterMonitorRefresh?: Map<string, unknown>;
  };
  g.__ctrlcenterMonitorCache?.clear();
  g.__ctrlcenterMonitorRefresh?.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getMonitorSnapshot", () => {
  it("never fetches for services that are disabled or missing a URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const snap = await getMonitorSnapshot(
      integrations({ radarr: { enabled: true, url: "   ", apiKey: "k" } })
    );
    expect(snap.qbittorrent).toEqual({
      configured: false,
      data: null,
      error: null,
      at: null,
    });
    expect(snap.radarr.configured).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks only on a cold cache, then serves the cache within the TTL", async () => {
    const fetchMock = stubSonarr(() => 5);
    const first = await getMonitorSnapshot(sonarrOn());
    const second = await getMonitorSnapshot(sonarrOn());

    expect(first.sonarr.configured).toBe(true);
    expect(first.sonarr.data?.upcoming).toHaveLength(5);
    expect(second.sonarr.data?.upcoming).toHaveLength(5);
    // One calendar + one history + one health fetch — the second was cached.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("serves an expired entry immediately and refreshes behind the response", async () => {
    let total = 1;
    stubSonarr(() => total);
    const base = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(base);
    await getMonitorSnapshot(sonarrOn());

    total = 2;
    now.mockReturnValue(base + TTL + 1);
    // The stale snapshot comes back without waiting on the refresh.
    const stale = await getMonitorSnapshot(sonarrOn());
    expect(stale.sonarr.data?.upcoming).toHaveLength(1);

    await settle();
    const fresh = await getMonitorSnapshot(sonarrOn());
    expect(fresh.sonarr.data?.upcoming).toHaveLength(2);
  });

  it("keeps the last good data and reports the error when a refresh fails", async () => {
    let status = 200;
    stubSonarr(() => 4, () => status);
    const base = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(base);
    await getMonitorSnapshot(sonarrOn());

    status = 500;
    now.mockReturnValue(base + TTL + 1);
    await getMonitorSnapshot(sonarrOn());
    await settle();

    const after = await getMonitorSnapshot(sonarrOn());
    expect(after.sonarr.data?.upcoming).toHaveLength(4); // stale-on-failure
    expect(after.sonarr.error).toBe("HTTP 500");
  });

  it("treats a config edit as a cold cache instead of serving the old target", async () => {
    const fetchMock = stubSonarr(() => 3);
    await getMonitorSnapshot(sonarrOn("http://sonarr-a.local"));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Same service, new URL, well within the TTL: must refetch, not reuse.
    await getMonitorSnapshot(sonarrOn("http://sonarr-b.local"));
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).startsWith("http://sonarr-b.local/")
      )
    ).toBe(true);
  });
});
