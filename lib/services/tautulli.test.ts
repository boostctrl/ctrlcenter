import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTautulliSnapshot,
  probeTautulli,
  resolveTautulliApiKey,
  mapTautulliActivity,
  TAUTULLI_SESSION_CAP,
} from "./tautulli";

// Trailing slash on purpose: the client must trim it before joining paths.
const CFG = { url: "http://tautulli.local:8181/", apiKey: "key123" };

const ACTIVITY = {
  stream_count: "2",
  total_bandwidth: "12500",
  sessions: [
    {
      friendly_name: "elliott",
      full_title: "Severance - Hello, Ms. Cobel",
      state: "playing",
      transcode_decision: "direct play",
      progress_percent: "42",
      quality_profile: "1080p",
    },
    {
      user: "guest",
      full_title: "Dune: Part Two",
      state: "paused",
      transcode_decision: "transcode",
      progress_percent: "87.5",
      quality_profile: "720p",
    },
  ],
};

const ok = (data: unknown) =>
  JSON.stringify({ response: { result: "success", message: null, data } });

function stubApi(opts: {
  activity?: unknown;
  info?: unknown;
  body?: (cmd: string) => string | null;
  status?: number;
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (opts.status) return new Response("boom", { status: opts.status });
    const cmd = /[?&]cmd=([^&]+)/.exec(url)?.[1] ?? "";
    const custom = opts.body?.(cmd);
    if (custom !== null && custom !== undefined) return new Response(custom);
    if (cmd === "get_activity") return new Response(ok(opts.activity ?? ACTIVITY));
    if (cmd === "get_tautulli_info")
      return new Response(ok(opts.info ?? { tautulli_version: "v2.13.4" }));
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

describe("getTautulliSnapshot", () => {
  it("maps activity, coercing Tautulli's string numbers", async () => {
    const fetchMock = stubApi({});
    const snap = await getTautulliSnapshot(CFG);
    expect(snap.streamCount).toBe(2);
    expect(snap.transcodeCount).toBe(1);
    expect(snap.totalBandwidthKbps).toBe(12500);
    expect(snap.sessions).toEqual([
      {
        user: "elliott",
        title: "Severance - Hello, Ms. Cobel",
        state: "playing",
        playback: "direct",
        progress: 42,
        quality: "1080p",
      },
      {
        user: "guest",
        title: "Dune: Part Two",
        state: "paused",
        playback: "transcode",
        progress: 87.5,
        quality: "720p",
      },
    ]);
    // The key rides the query string; the trailing slash is trimmed.
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(/^http:\/\/tautulli\.local:8181\/api\/v2\?apikey=key123&/);
  });

  it("reports a bad key from Tautulli's 200-with-error envelope", async () => {
    stubApi({
      body: () =>
        JSON.stringify({
          response: { result: "error", message: "Invalid apikey" },
        }),
    });
    await expect(getTautulliSnapshot(CFG)).rejects.toThrow("Invalid API key");
  });

  it("reports other envelope errors generically", async () => {
    stubApi({
      body: () =>
        JSON.stringify({ response: { result: "error", message: "boom" } }),
    });
    await expect(getTautulliSnapshot(CFG)).rejects.toThrow(
      "Tautulli reported an error"
    );
  });
});

describe("mapTautulliActivity", () => {
  it("caps the session list and tolerates missing fields", () => {
    const sessions = Array.from({ length: 10 }, () => ({}));
    const snap = mapTautulliActivity({ sessions });
    expect(snap.sessions).toHaveLength(TAUTULLI_SESSION_CAP);
    expect(snap.sessions[0]).toEqual({
      user: "(unknown)",
      title: "(unknown)",
      state: "playing",
      playback: "direct",
      progress: 0,
      quality: "",
    });
    // No stream_count in the payload — fall back to the session rows.
    expect(snap.streamCount).toBe(10);
    expect(snap.totalBandwidthKbps).toBeNull();
  });
});

describe("probeTautulli", () => {
  it("names the version that answered", async () => {
    stubApi({});
    expect(await probeTautulli(CFG)).toEqual({
      ok: true,
      detail: "Tautulli v2.13.4",
    });
  });

  it("folds an unreachable service into the result shape", async () => {
    stubApi({ status: 502 });
    expect(await probeTautulli(CFG)).toEqual({ ok: false, error: "HTTP 502" });
  });
});

describe("resolveTautulliApiKey", () => {
  it("prefers the env var over the stored key", () => {
    vi.stubEnv("CTRLCENTER_TAUTULLI_KEY", "env-key");
    expect(resolveTautulliApiKey({ apiKey: "stored" })).toBe("env-key");
  });

  it("falls back to the stored key when the env var is unset", () => {
    vi.stubEnv("CTRLCENTER_TAUTULLI_KEY", "");
    expect(resolveTautulliApiKey({ apiKey: "stored" })).toBe("stored");
  });
});
