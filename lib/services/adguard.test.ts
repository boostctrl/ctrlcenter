import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAdguardSnapshot,
  probeAdguard,
  resolveAdguardPassword,
  mapAdguardSnapshot,
  ADGUARD_TOP_BLOCKED_CAP,
} from "./adguard";

// Trailing slash on purpose: the client must trim it before joining paths.
const CFG = { url: "http://adguard.local:3000/", username: "admin", password: "pw" };

const STATUS = { version: "v0.107.52", protection_enabled: true };
const STATS = {
  time_units: "hours",
  num_dns_queries: 10_000,
  num_blocked_filtering: 750,
  avg_processing_time: 0.0123,
  dns_queries: Array.from({ length: 24 }, () => 400),
  top_blocked_domains: [{ "ads.example.com": 320 }, { "track.example.net": 120 }],
};

function stubEndpoints(opts: {
  status?: unknown;
  stats?: unknown;
  fail?: (url: string) => number | null;
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const failStatus = opts.fail?.(url) ?? null;
    if (failStatus) return new Response("Forbidden", { status: failStatus });
    if (url.includes("/control/status")) {
      return new Response(JSON.stringify(opts.status ?? STATUS));
    }
    if (url.includes("/control/stats")) {
      return new Response(JSON.stringify(opts.stats ?? STATS));
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

describe("getAdguardSnapshot", () => {
  it("maps status and stats into the snapshot", async () => {
    const fetchMock = stubEndpoints({});
    const snap = await getAdguardSnapshot(CFG);
    expect(snap.protectionEnabled).toBe(true);
    expect(snap.totalQueries).toBe(10_000);
    expect(snap.blocked).toBe(750);
    expect(snap.blockedRatio).toBeCloseTo(0.075);
    expect(snap.avgProcessingMs).toBeCloseTo(12.3);
    expect(snap.windowLabel).toBe("last 24 hours");
    // The per-unit query series (for the face's sparkline) carries every value.
    expect(snap.series).toHaveLength(24);
    expect(snap.series[0]).toBe(400);
    expect(snap.topBlocked).toEqual([
      { domain: "ads.example.com", count: 320 },
      { domain: "track.example.net", count: 120 },
    ]);
    // Basic auth goes on every request; the URL's trailing slash is trimmed.
    for (const [input, init] of fetchMock.mock.calls) {
      expect(String(input)).toMatch(/^http:\/\/adguard\.local:3000\/control\//);
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe(
        "Basic " + Buffer.from("admin:pw").toString("base64")
      );
    }
  });

  it("sends no Authorization header when no username is set", async () => {
    const fetchMock = stubEndpoints({});
    await getAdguardSnapshot({ ...CFG, username: "  " });
    for (const [, init] of fetchMock.mock.calls) {
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    }
  });

  it("maps a 403 to a login-failed message", async () => {
    stubEndpoints({ fail: () => 403 });
    await expect(getAdguardSnapshot(CFG)).rejects.toThrow(
      "Login failed — check the username and password"
    );
  });
});

describe("mapAdguardSnapshot", () => {
  it("caps the top-blocked list and skips malformed entries", () => {
    const domains = Array.from({ length: 10 }, (_, i) => ({
      [`d${i}.example`]: i,
    }));
    const snap = mapAdguardSnapshot(STATUS, {
      ...STATS,
      top_blocked_domains: [null, {}, ...domains],
    });
    expect(snap.topBlocked).toHaveLength(ADGUARD_TOP_BLOCKED_CAP);
    expect(snap.topBlocked[0]).toEqual({ domain: "d0.example", count: 0 });
  });

  it("reports a days window and tolerates missing stats fields", () => {
    const snap = mapAdguardSnapshot(
      { protection_enabled: false },
      { time_units: "days", dns_queries: [1, 2, 3, 4, 5, 6, 7] }
    );
    expect(snap.protectionEnabled).toBe(false);
    expect(snap.windowLabel).toBe("last 7 days");
    expect(snap.totalQueries).toBe(0);
    expect(snap.blockedRatio).toBe(0);
    expect(snap.avgProcessingMs).toBeNull();
    expect(snap.topBlocked).toEqual([]);
  });
});

describe("probeAdguard", () => {
  it("names the version that answered", async () => {
    stubEndpoints({});
    expect(await probeAdguard(CFG)).toEqual({
      ok: true,
      detail: "AdGuard Home v0.107.52",
    });
  });

  it("rejects a JSON endpoint that isn't AdGuard Home", async () => {
    stubEndpoints({ status: { some: "thing" } });
    expect(await probeAdguard(CFG)).toEqual({
      ok: false,
      error: "Is the URL an AdGuard Home instance?",
    });
  });

  it("folds an unreachable service into the result shape", async () => {
    stubEndpoints({ fail: () => 503 });
    expect(await probeAdguard(CFG)).toEqual({ ok: false, error: "HTTP 503" });
  });
});

describe("resolveAdguardPassword", () => {
  it("prefers the env var over the stored password", () => {
    vi.stubEnv("CTRLCENTER_ADGUARD_PASS", "env-pw");
    expect(resolveAdguardPassword({ password: "stored" })).toBe("env-pw");
  });

  it("falls back to the stored password when the env var is unset", () => {
    vi.stubEnv("CTRLCENTER_ADGUARD_PASS", "");
    expect(resolveAdguardPassword({ password: "stored" })).toBe("stored");
  });
});
