import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMonitorSnapshot, invalidateService } from "./monitor";
import { swrCache } from "./swr-cache";
import { integrationSchema, type Integration } from "./schema";
import { SERVICE_IDS, type ServiceId } from "./services/ids";
import type { MonitorSnapshot } from "./monitor";
import type { ArrSnapshot } from "./services/arr";

const TTL = 30_000;

// One integration of every type, id = type, all off — the shape a migrated
// 2.x config has — with `over` merged per type.
type Over = Partial<Record<ServiceId, Partial<Integration>>>;
const integrations = (over: Over = {}): Integration[] =>
  SERVICE_IDS.map((type) =>
    integrationSchema.parse({ id: type, type, enabled: false, ...over[type] })
  );

// The Sonarr entry's upcoming list.
const upcoming = (snap: MonitorSnapshot) =>
  (at(snap, "sonarr").data as ArrSnapshot | null)?.upcoming;

// Look an integration up in a snapshot by id.
const at = (snap: MonitorSnapshot, id: string) => {
  const entry = snap.find((e) => e.id === id);
  if (!entry) throw new Error(`no ${id}`);
  return entry;
};

// Sonarr is the simplest service to drive end-to-end (no login dance).
const sonarrOn = (url = "http://sonarr.local:8989") =>
  integrations({ sonarr: { enabled: true, url, apiKey: "k", allowInsecureTls: false, allowActions: false } });

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

// A promise whose resolution the test controls, to hold one refresh open while
// another completes.
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  // The cache lives on globalThis and survives across tests in a run.
  swrCache("monitor", 0).deleteWhere(() => true);
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
      integrations({ radarr: { enabled: true, url: "   ", apiKey: "k", allowInsecureTls: false, allowActions: false } })
    );
    expect(at(snap, "qbittorrent")).toMatchObject({
      configured: false,
      enabled: false,
      urlSet: false,
      actionsAllowed: false,
      data: null,
      error: null,
      at: null,
    });
    expect(at(snap, "radarr").configured).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("distinguishes disabled, not-set-up, and configured via enabled/urlSet (#208)", async () => {
    const fetchMock = stubSonarr(() => 1);
    const snap = await getMonitorSnapshot(
      integrations({
        // Disabled: has a URL, toggle off — reads "off, not broken".
        qbittorrent: {
          enabled: false,
          url: "http://qb.local",
          username: "",
          password: "",
          allowInsecureTls: false,
          allowActions: false,
        },
        // Never set up: enabled but no URL — reads as onboarding.
        radarr: { enabled: true, url: "", apiKey: "", allowInsecureTls: false, allowActions: false },
        // Fully configured — polls and reports data.
        sonarr: { enabled: true, url: "http://sonarr.local:8989", apiKey: "k", allowInsecureTls: false, allowActions: false },
      })
    );

    expect(at(snap, "qbittorrent").configured).toBe(false);
    expect(at(snap, "qbittorrent").enabled).toBe(false);
    expect(at(snap, "qbittorrent").urlSet).toBe(true);

    expect(at(snap, "radarr").configured).toBe(false);
    expect(at(snap, "radarr").enabled).toBe(true);
    expect(at(snap, "radarr").urlSet).toBe(false);

    expect(at(snap, "sonarr").configured).toBe(true);
    expect(at(snap, "sonarr").enabled).toBe(true);
    expect(at(snap, "sonarr").urlSet).toBe(true);
    // Only the configured service was polled.
    expect(
      fetchMock.mock.calls.every(([input]) =>
        String(input).startsWith("http://sonarr.local")
      )
    ).toBe(true);
  });

  it("re-fetches after invalidateService drops the cached snapshot", async () => {
    const fetchMock = stubSonarr(() => 3);
    await getMonitorSnapshot(sonarrOn());
    const afterFirst = fetchMock.mock.calls.length;
    // Within the TTL a second read is served from cache — no new fetch.
    await getMonitorSnapshot(sonarrOn());
    expect(fetchMock.mock.calls.length).toBe(afterFirst);
    // Invalidating forces the next read to fetch fresh (as a write action does).
    invalidateService("sonarr");
    await getMonitorSnapshot(sonarrOn());
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it("marks actionsAllowed only when the integration is configured and opted in", async () => {
    stubSonarr(() => 1);
    // Configured but actions off (the default posture) — read-only.
    const readOnly = await getMonitorSnapshot(sonarrOn());
    expect(at(readOnly, "sonarr").configured).toBe(true);
    expect(at(readOnly, "sonarr").actionsAllowed).toBe(false);

    // Same target with the opt-in turned on — actions live.
    const opted = await getMonitorSnapshot(
      integrations({
        sonarr: { enabled: true, url: "http://sonarr.local:8989", apiKey: "k", allowInsecureTls: false, allowActions: true },
      })
    );
    expect(at(opted, "sonarr").actionsAllowed).toBe(true);
  });

  it("blocks only on a cold cache, then serves the cache within the TTL", async () => {
    const fetchMock = stubSonarr(() => 5);
    const first = await getMonitorSnapshot(sonarrOn());
    const second = await getMonitorSnapshot(sonarrOn());

    expect(at(first, "sonarr").configured).toBe(true);
    expect(upcoming(first)).toHaveLength(5);
    expect(upcoming(second)).toHaveLength(5);
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
    expect(upcoming(stale)).toHaveLength(1);

    await settle();
    const fresh = await getMonitorSnapshot(sonarrOn());
    expect(upcoming(fresh)).toHaveLength(2);
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
    expect(upcoming(after)).toHaveLength(4); // stale-on-failure
    expect(at(after, "sonarr").error).toBe("HTTP 500");
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

  it("drops a superseded refresh's late write instead of forcing a blocking refetch (#211)", async () => {
    // Two quick edits (A then B) for the same service race: A's refresh is held
    // open until after B's completes and caches. The stale A write must be
    // dropped so the cache keeps B — otherwise the next B read sees a key
    // mismatch and blocks on a redundant refetch.
    const gate = deferred();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("http://a.local")) await gate.promise; // hold A open
      if (url.includes("/api/v3/calendar")) {
        const episodes = Array.from({ length: 3 }, (_, i) => ({
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

    const pA = getMonitorSnapshot(sonarrOn("http://a.local"));
    const pB = getMonitorSnapshot(sonarrOn("http://b.local"));
    await pB; // B (ungated) resolves first and caches
    gate.resolve(); // release A, whose write should now be dropped
    await pA;

    const callsAfterRace = fetchMock.mock.calls.length; // A(3) + B(3)
    const readB = await getMonitorSnapshot(sonarrOn("http://b.local"));
    expect(upcoming(readB)).toHaveLength(3); // still B's data
    // Served from cache: no redundant blocking refetch was triggered.
    expect(fetchMock.mock.calls.length).toBe(callsAfterRace);
  });
});

describe("integration instances (#300)", () => {
  it("polls two of a type separately, each labelled", async () => {
    const fetchMock = stubSonarr(() => 2);
    const snap = await getMonitorSnapshot([
      integrationSchema.parse({ id: "sonarr", type: "sonarr", url: "http://hd.local:8989", apiKey: "a" }),
      integrationSchema.parse({ id: "sonarr-4k", type: "sonarr", name: "Sonarr 4K", url: "http://uhd.local:8989", apiKey: "b" }),
      integrationSchema.parse({ id: "sonarr-3", type: "sonarr", url: "http://x.local:8989", apiKey: "c", enabled: false }),
    ]);
    expect(snap.map((e) => [e.id, e.label, e.configured])).toEqual([
      ["sonarr", "Sonarr", true],
      ["sonarr-4k", "Sonarr 4K", true],
      ["sonarr-3", "Sonarr 2", false],
    ]);
    const hosts = new Set(fetchMock.mock.calls.map(([u]) => new URL(String(u)).host));
    expect(hosts).toEqual(new Set(["hd.local:8989", "uhd.local:8989"]));
  });

  it("sends a key from an ${ENV} reference, and the legacy variable only to the migrated id", async () => {
    vi.stubEnv("SONARR_4K_KEY", "from-ref");
    vi.stubEnv("CTRLCENTER_SONARR_KEY", "legacy");
    const fetchMock = stubSonarr(() => 1);
    await getMonitorSnapshot([
      integrationSchema.parse({ id: "sonarr", type: "sonarr", url: "http://hd.local:8989", apiKey: "stored" }),
      integrationSchema.parse({ id: "uhd", type: "sonarr", url: "http://uhd.local:8989", apiKey: "${SONARR_4K_KEY}" }),
      integrationSchema.parse({ id: "other", type: "sonarr", url: "http://other.local:8989", apiKey: "own" }),
    ]);
    const keyFor = (host: string) =>
      fetchMock.mock.calls
        .filter(([u]) => new URL(String(u)).host === host)
        .map((call) => new Headers(((call as unknown[])[1] as RequestInit | undefined)?.headers).get("X-Api-Key"))[0];
    expect(keyFor("hd.local:8989")).toBe("legacy");
    expect(keyFor("uhd.local:8989")).toBe("from-ref");
    expect(keyFor("other.local:8989")).toBe("own");
    vi.unstubAllEnvs();
  });
});

