import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getArrSnapshot,
  probeArr,
  resolveArrApiKey,
  mapSonarrCalendar,
  mapHistory,
  ARR_UPCOMING_CAP,
  ARR_RECENT_CAP,
} from "./arr";

// Trailing slash on purpose: the client must trim it before joining paths.
const CFG = { url: "http://sonarr.local:8989/", apiKey: "key123" };

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

// Dispatching fetch stub for the calendar/history/health/status endpoints. A
// `fail(url)` returning a status code fails that endpoint; otherwise the
// matching body is returned.
function stubEndpoints(opts: {
  calendar?: unknown;
  history?: unknown;
  health?: unknown;
  status?: unknown;
  fail?: (url: string) => number | null;
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const failStatus = opts.fail?.(url) ?? null;
    if (failStatus) return new Response("boom", { status: failStatus });
    if (url.includes("/api/v3/calendar")) {
      return new Response(JSON.stringify(opts.calendar ?? []));
    }
    if (url.includes("/api/v3/history")) {
      return new Response(JSON.stringify(opts.history ?? { records: [] }));
    }
    if (url.includes("/api/v3/health")) {
      return new Response(JSON.stringify(opts.health ?? []));
    }
    if (url.includes("/api/v3/system/status")) {
      return new Response(JSON.stringify(opts.status ?? {}));
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

describe("getArrSnapshot (sonarr)", () => {
  it("maps the calendar to upcoming, history to recent, and health", async () => {
    const calendar = [
      {
        airDateUtc: iso(2 * 3_600_000),
        seasonNumber: 6,
        episodeNumber: 4,
        series: { title: "The Expanse" },
      },
      {
        airDateUtc: iso(1 * 3_600_000),
        seasonNumber: 2,
        episodeNumber: 1,
        series: { title: "Severance" },
      },
    ];
    const history = {
      records: [
        {
          eventType: "grabbed",
          date: iso(-2 * 3_600_000),
          series: { title: "Silo" },
          episode: { seasonNumber: 2, episodeNumber: 6 },
        },
        // A rename event is skipped — only grabs/imports are "recent".
        {
          eventType: "episodeFileRenamed",
          date: iso(-3 * 3_600_000),
          series: { title: "Ignored" },
        },
        {
          eventType: "downloadFolderImported",
          date: iso(-4 * 3_600_000),
          series: { title: "Foundation" },
          episode: { seasonNumber: 3, episodeNumber: 8 },
        },
      ],
    };
    const fetchMock = stubEndpoints({
      calendar,
      history,
      health: [{ type: "warning", message: "Indexer down" }],
    });

    const snap = await getArrSnapshot("sonarr", CFG);

    // Upcoming is sorted by air time ascending.
    expect(snap.upcoming.map((u) => u.title)).toEqual([
      "Severance",
      "The Expanse",
    ]);
    expect(snap.upcoming[0].subtitle).toBe("S02E01");
    expect(snap.recent).toEqual([
      { title: "Silo", subtitle: "S02E06", event: "grabbed", at: expect.any(Number) },
      {
        title: "Foundation",
        subtitle: "S03E08",
        event: "imported",
        at: expect.any(Number),
      },
    ]);
    expect(snap.health).toEqual([{ type: "warning", message: "Indexer down" }]);

    // Every call trims the trailing slash and carries the API key.
    for (const [input, init] of fetchMock.mock.calls as [
      RequestInfo,
      RequestInit,
    ][]) {
      expect(String(input)).toMatch(/^http:\/\/sonarr\.local:8989\/api\/v3\//);
      expect(new Headers(init.headers).get("x-api-key")).toBe("key123");
    }
    const calCall = fetchMock.mock.calls.find(([i]) =>
      String(i).includes("/calendar")
    ) as [RequestInfo, RequestInit];
    expect(String(calCall[0])).toContain("includeSeries=true");
  });

  it("tolerates a failed history endpoint without blanking the card", async () => {
    stubEndpoints({
      calendar: [
        { airDateUtc: iso(3_600_000), seasonNumber: 1, episodeNumber: 1, series: { title: "Show" } },
      ],
      health: [{ type: "warning", message: "heads up" }],
      fail: (url) => (url.includes("/history") ? 500 : null),
    });
    const snap = await getArrSnapshot("sonarr", CFG);
    expect(snap.upcoming).toHaveLength(1);
    expect(snap.recent).toEqual([]);
    expect(snap.health).toHaveLength(1);
  });

  it("throws when every endpoint fails (bad key / unreachable)", async () => {
    stubEndpoints({ fail: () => 401 });
    await expect(getArrSnapshot("sonarr", CFG)).rejects.toThrow("Invalid API key");
  });
});

describe("getArrSnapshot (radarr)", () => {
  it("maps movie calendar and history", async () => {
    const calendar = [
      { title: "Dune Part Three", year: 2026, digitalRelease: iso(3 * 86_400_000) },
    ];
    const history = {
      records: [
        {
          eventType: "movieFileImported",
          date: iso(-6 * 3_600_000),
          movie: { title: "Sinners", year: 2025 },
        },
      ],
    };
    const fetchMock = stubEndpoints({ calendar, history });
    const snap = await getArrSnapshot("radarr", CFG);

    expect(snap.upcoming[0].title).toBe("Dune Part Three");
    expect(snap.upcoming[0].subtitle).toContain("2026");
    expect(snap.upcoming[0].subtitle).toContain("Digital");
    expect(snap.recent[0]).toMatchObject({
      event: "imported",
      title: "Sinners",
      subtitle: "2025",
    });

    // Radarr history asks the movie to be embedded, not the series/episode.
    const histCall = fetchMock.mock.calls.find(([i]) =>
      String(i).includes("/history")
    ) as [RequestInfo, RequestInit];
    expect(String(histCall[0])).toContain("includeMovie=true");
  });
});

describe("calendar/history mappers", () => {
  it("mapSonarrCalendar sorts by air time and caps the list", () => {
    const raw = Array.from({ length: ARR_UPCOMING_CAP + 4 }, (_, i) => ({
      airDateUtc: iso((ARR_UPCOMING_CAP + 4 - i) * 3_600_000),
      seasonNumber: 1,
      episodeNumber: i + 1,
      series: { title: `Show ${i}` },
    }));
    const out = mapSonarrCalendar(raw);
    expect(out).toHaveLength(ARR_UPCOMING_CAP);
    // Earliest air time first (the last raw item has the smallest offset).
    expect(out[0].at! < out[1].at!).toBe(true);
  });

  it("mapHistory keeps only grabs/imports and caps the list", () => {
    const records = [
      { eventType: "grabbed", date: iso(-1000), series: { title: "A" } },
      { eventType: "episodeFileDeleted", date: iso(-2000), series: { title: "B" } },
      { eventType: "downloadFolderImported", date: iso(-3000), series: { title: "C" } },
      ...Array.from({ length: 10 }, (_, i) => ({
        eventType: "grabbed",
        date: iso(-4000 - i),
        series: { title: `G${i}` },
      })),
    ];
    const out = mapHistory("sonarr", { records });
    expect(out.length).toBe(ARR_RECENT_CAP);
    // The deleted event was skipped.
    expect(out.some((r) => r.title === "B")).toBe(false);
  });

  it("mapHistory honors a larger cap for the detail read", () => {
    const records = Array.from({ length: 40 }, (_, i) => ({
      eventType: "grabbed",
      date: iso(-i),
      series: { title: `G${i}` },
    }));
    // The default cap stays lean; the detail cap keeps more.
    expect(mapHistory("sonarr", { records })).toHaveLength(ARR_RECENT_CAP);
    expect(mapHistory("sonarr", { records }, 30)).toHaveLength(30);
  });
});

describe("probeArr", () => {
  it("names the app and version that answered", async () => {
    stubEndpoints({ status: { appName: "Sonarr", version: "4.0.10" } });
    expect(await probeArr("sonarr", CFG)).toEqual({
      ok: true,
      detail: "Sonarr 4.0.10",
    });
  });

  it("falls back to the service label when the status omits appName", async () => {
    stubEndpoints({ status: { version: "5.1.0" } });
    expect(await probeArr("radarr", CFG)).toEqual({
      ok: true,
      detail: "Radarr 5.1.0",
    });
  });

  it("folds an unreachable service into the result shape", async () => {
    stubEndpoints({ fail: () => 500 });
    expect(await probeArr("sonarr", CFG)).toEqual({ ok: false, error: "HTTP 500" });
  });
});

describe("resolveArrApiKey", () => {
  it("prefers the per-service env var over the stored key", () => {
    vi.stubEnv("CTRLCENTER_SONARR_KEY", "env-sonarr");
    vi.stubEnv("CTRLCENTER_RADARR_KEY", "env-radarr");
    expect(resolveArrApiKey("sonarr", { apiKey: "file" })).toBe("env-sonarr");
    expect(resolveArrApiKey("radarr", { apiKey: "file" })).toBe("env-radarr");
  });

  it("falls back to the stored key when the env var is unset", () => {
    vi.stubEnv("CTRLCENTER_SONARR_KEY", "");
    expect(resolveArrApiKey("sonarr", { apiKey: "file" })).toBe("file");
  });
});
