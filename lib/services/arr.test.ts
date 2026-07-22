import { afterEach, describe, expect, it, vi } from "vitest";
import { getArrSnapshot, probeArr, resolveArrApiKey } from "./arr";

// Trailing slash on purpose: the client must trim it before joining paths.
const CFG = { url: "http://sonarr.local:8989/", apiKey: "key123" };

function stubArr({
  queue = {
    totalRecords: 42,
    records: [
      {
        title: "Show S01E01",
        status: "downloading",
        size: 1000,
        sizeleft: 250,
        timeleft: "00:12:34",
      },
      { title: "", status: "queued" }, // no sizes, no title
    ],
  } as unknown,
  missing = { totalRecords: 7 } as unknown,
  health = [
    { type: "error", message: "Indexer unavailable" },
    { type: "notice", message: "Update available" },
    { type: "warning", message: "" }, // empty message → dropped
  ] as unknown,
  status = { appName: "Sonarr", version: "4.0.10" } as unknown,
  httpStatus = 200,
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (httpStatus !== 200) {
      return new Response("denied", { status: httpStatus });
    }
    const url = String(input);
    const body = url.includes("/api/v3/queue")
      ? queue
      : url.includes("/api/v3/wanted/missing")
        ? missing
        : url.includes("/api/v3/health")
          ? health
          : url.includes("/api/v3/system/status")
            ? status
            : null;
    return body !== null
      ? new Response(JSON.stringify(body))
      : new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getArrSnapshot", () => {
  it("maps the queue, missing count, and health, with the API key sent", async () => {
    const fetchMock = stubArr();
    const snap = await getArrSnapshot("sonarr", CFG);

    expect(snap.queueCount).toBe(42);
    expect(snap.queue).toEqual([
      {
        title: "Show S01E01",
        status: "downloading",
        progress: 0.75,
        timeLeft: "00:12:34",
      },
      { title: "(unnamed)", status: "queued", progress: null, timeLeft: null },
    ]);
    expect(snap.missingCount).toBe(7);
    // Only real messages survive; unknown types coerce to "warning".
    expect(snap.health).toEqual([
      { type: "error", message: "Indexer unavailable" },
      { type: "warning", message: "Update available" },
    ]);

    for (const [input, init] of fetchMock.mock.calls as [
      RequestInfo,
      RequestInit,
    ][]) {
      // The trailing slash was trimmed before the path join.
      expect(String(input)).toMatch(/^http:\/\/sonarr\.local:8989\/api\/v3\//);
      expect(new Headers(init.headers).get("x-api-key")).toBe("key123");
    }
  });

  it("reports a 401 as an invalid API key", async () => {
    stubArr({ httpStatus: 401 });
    await expect(getArrSnapshot("sonarr", CFG)).rejects.toThrow(
      "Invalid API key"
    );
  });

  it("tolerates a failed health check instead of blanking the whole card", async () => {
    // Only /health flakes; queue and missing succeed.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v3/health")) {
        return new Response("boom", { status: 500 });
      }
      if (url.includes("/api/v3/queue")) {
        return new Response(JSON.stringify({ totalRecords: 3, records: [] }));
      }
      if (url.includes("/api/v3/wanted/missing")) {
        return new Response(JSON.stringify({ totalRecords: 4 }));
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const snap = await getArrSnapshot("sonarr", CFG);
    expect(snap.queueCount).toBe(3);
    expect(snap.missingCount).toBe(4);
    expect(snap.health).toEqual([]);
  });

  it("still fails when the core queue call fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v3/queue")) {
        return new Response("boom", { status: 500 });
      }
      return new Response(JSON.stringify({ totalRecords: 0, records: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getArrSnapshot("sonarr", CFG)).rejects.toThrow("HTTP 500");
  });
});

describe("probeArr", () => {
  it("names the app and version that answered", async () => {
    stubArr();
    expect(await probeArr("sonarr", CFG)).toEqual({
      ok: true,
      detail: "Sonarr 4.0.10",
    });
  });

  it("falls back to the service label when the status omits appName", async () => {
    stubArr({ status: { version: "5.1.0" } });
    expect(await probeArr("radarr", CFG)).toEqual({
      ok: true,
      detail: "Radarr 5.1.0",
    });
  });

  it("folds an unreachable service into the result shape", async () => {
    stubArr({ httpStatus: 500 });
    const result = await probeArr("sonarr", CFG);
    expect(result).toEqual({ ok: false, error: "HTTP 500" });
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
