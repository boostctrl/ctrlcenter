import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approveRequest,
  declineRequest,
  getSeerrSnapshot,
  probeSeerr,
  resolveSeerrApiKey,
  mapSeerrRequest,
  requestStatus,
} from "./seerr";

const CFG = { url: "http://seerr.local:5055/", apiKey: "key123" };

const COUNT = { pending: 3, processing: 1, available: 40, total: 52 };
const REQUESTS = {
  results: [
    {
      id: 101,
      status: 1,
      type: "movie",
      createdAt: "2026-07-20T10:00:00.000Z",
      media: { tmdbId: 693134, mediaType: "movie", status: 2 },
      requestedBy: { displayName: "Elliott", username: "e" },
    },
    {
      id: 102,
      status: 2,
      type: "tv",
      createdAt: "2026-07-19T08:00:00.000Z",
      media: { tmdbId: 95396, mediaType: "tv", status: 5 },
      requestedBy: { username: "guest" },
    },
  ],
};

function stubApi(opts: {
  count?: unknown;
  requests?: unknown;
  status?: unknown;
  titles?: Record<string, unknown>;
  fail?: (url: string) => number | null;
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const failStatus = opts.fail?.(url) ?? null;
    if (failStatus) return new Response("nope", { status: failStatus });
    if (url.includes("/api/v1/request/count")) {
      return new Response(JSON.stringify(opts.count ?? COUNT));
    }
    if (url.includes("/api/v1/request")) {
      return new Response(JSON.stringify(opts.requests ?? REQUESTS));
    }
    if (url.includes("/api/v1/status")) {
      return new Response(JSON.stringify(opts.status ?? { version: "1.0.0" }));
    }
    const movie = /\/api\/v1\/movie\/(\d+)/.exec(url)?.[1];
    if (movie) {
      return new Response(
        JSON.stringify(opts.titles?.[`movie/${movie}`] ?? { title: `Movie ${movie}` })
      );
    }
    const tv = /\/api\/v1\/tv\/(\d+)/.exec(url)?.[1];
    if (tv) {
      return new Response(
        JSON.stringify(opts.titles?.[`tv/${tv}`] ?? { name: `Show ${tv}` })
      );
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

describe("getSeerrSnapshot", () => {
  it("maps counts and resolves each request's title", async () => {
    const fetchMock = stubApi({});
    const snap = await getSeerrSnapshot(CFG);
    expect(snap).toMatchObject({
      pending: 3,
      processing: 1,
      available: 40,
      totalRequests: 52,
    });
    expect(snap.requests).toEqual([
      {
        id: 101,
        title: "Movie 693134",
        requester: "Elliott",
        type: "movie",
        status: "pending",
        at: Date.parse("2026-07-20T10:00:00.000Z"),
      },
      {
        id: 102,
        title: "Show 95396",
        requester: "guest",
        type: "tv",
        status: "available",
        at: Date.parse("2026-07-19T08:00:00.000Z"),
      },
    ]);
    // The key rides X-Api-Key on every call.
    for (const [, init] of fetchMock.mock.calls) {
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers["X-Api-Key"]).toBe("key123");
    }
  });

  it("falls back to a placeholder when a title lookup fails", async () => {
    stubApi({ fail: (url) => (url.includes("/api/v1/movie/") ? 500 : null) });
    const snap = await getSeerrSnapshot(CFG);
    expect(snap.requests[0].title).toBe("Movie #693134");
    // A failed title lookup must not blank the other request.
    expect(snap.requests[1].title).toBe("Show 95396");
  });

  it("maps a 403 to an invalid-key message", async () => {
    stubApi({ fail: (url) => (url.includes("/request/count") ? 403 : null) });
    await expect(getSeerrSnapshot(CFG)).rejects.toThrow("Invalid API key");
  });
});

describe("Seerr actions", () => {
  function stubAction(status = 200) {
    const fetchMock = vi.fn(async () => new Response("", { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("approves a request by POSTing to its approve endpoint with the key", async () => {
    const fetchMock = stubAction();
    await approveRequest(CFG, 101);
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo, RequestInit];
    expect(String(url)).toBe("http://seerr.local:5055/api/v1/request/101/approve");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("key123");
  });

  it("declines a request by POSTing to its decline endpoint", async () => {
    const fetchMock = stubAction();
    await declineRequest(CFG, 102);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://seerr.local:5055/api/v1/request/102/decline"
    );
  });

  it("maps a 403 to an invalid-key message", async () => {
    stubAction(403);
    await expect(approveRequest(CFG, 1)).rejects.toThrow("Invalid API key");
  });
});

describe("requestStatus", () => {
  it("prefers declined/pending, else reflects media progress", () => {
    expect(requestStatus({ status: 3 })).toBe("declined");
    expect(requestStatus({ status: 1 })).toBe("pending");
    expect(requestStatus({ status: 2, media: { status: 5 } })).toBe("available");
    expect(requestStatus({ status: 2, media: { status: 3 } })).toBe("processing");
    expect(requestStatus({ status: 2, media: { status: 2 } })).toBe("approved");
  });
});

describe("mapSeerrRequest", () => {
  it("prefers displayName, then plexUsername, then username", () => {
    expect(
      mapSeerrRequest(
        { requestedBy: { plexUsername: "plex", username: "u" } },
        "T"
      ).requester
    ).toBe("plex");
    expect(mapSeerrRequest({ requestedBy: {} }, "T").requester).toBe("(unknown)");
  });
});

describe("probeSeerr", () => {
  it("names the version that answered", async () => {
    stubApi({});
    expect(await probeSeerr(CFG)).toEqual({ ok: true, detail: "Seerr 1.0.0" });
  });

  it("folds an unreachable service into the result shape", async () => {
    stubApi({ fail: () => 502 });
    expect(await probeSeerr(CFG)).toEqual({ ok: false, error: "HTTP 502" });
  });
});

describe("resolveSeerrApiKey", () => {
  it("prefers the env var over the stored key", () => {
    vi.stubEnv("CTRLCENTER_SEERR_KEY", "env-key");
    expect(resolveSeerrApiKey({ apiKey: "stored" })).toBe("env-key");
  });

  it("falls back to the stored key when the env var is unset", () => {
    vi.stubEnv("CTRLCENTER_SEERR_KEY", "");
    expect(resolveSeerrApiKey({ apiKey: "stored" })).toBe("stored");
  });
});
