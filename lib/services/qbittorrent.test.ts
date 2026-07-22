import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getQbittorrentSnapshot,
  probeQbittorrent,
  resolveQbittorrentPassword,
  simplifyTorrentState,
  TORRENT_LIST_CAP,
} from "./qbittorrent";

const CFG = {
  url: "http://qbit.local:8080",
  username: "admin",
  password: "file-secret",
};

// The session-cookie cache lives on globalThis and survives across tests.
function clearSessions() {
  (
    globalThis as { __ctrlcenterQbitSessions?: Map<string, string> }
  ).__ctrlcenterQbitSessions?.clear();
}

const okLogin = () =>
  new Response("Ok.", {
    headers: { "set-cookie": "SID=abc123; HttpOnly; path=/" },
  });

// Dispatching fetch stub for the WebUI endpoints a snapshot/probe touches.
function stubQbit({
  torrents = [] as unknown[],
  transfer = { dl_info_speed: 1200, up_info_speed: 800 },
  badCredentials = false,
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v2/auth/login")) {
      return badCredentials ? new Response("Fails.") : okLogin();
    }
    if (url.endsWith("/api/v2/transfer/info")) {
      return new Response(JSON.stringify(transfer));
    }
    if (url.endsWith("/api/v2/torrents/info")) {
      return new Response(JSON.stringify(torrents));
    }
    if (url.endsWith("/api/v2/app/version")) return new Response("v5.0.1");
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const loginCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([input]) =>
    String(input).endsWith("/api/v2/auth/login")
  );

beforeEach(clearSessions);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("simplifyTorrentState", () => {
  it("buckets the raw states, including qBittorrent 5's renames", () => {
    expect(simplifyTorrentState("downloading")).toBe("downloading");
    expect(simplifyTorrentState("metaDL")).toBe("downloading");
    expect(simplifyTorrentState("stalledDL")).toBe("stalled");
    expect(simplifyTorrentState("uploading")).toBe("seeding");
    expect(simplifyTorrentState("stalledUP")).toBe("seeding");
    expect(simplifyTorrentState("pausedDL")).toBe("paused");
    expect(simplifyTorrentState("stoppedUP")).toBe("paused");
    expect(simplifyTorrentState("queuedDL")).toBe("queued");
    expect(simplifyTorrentState("checkingResumeData")).toBe("checking");
    expect(simplifyTorrentState("missingFiles")).toBe("error");
  });

  it("degrades an unknown future state to the neutral bucket", () => {
    expect(simplifyTorrentState("somethingNew")).toBe("stalled");
  });
});

describe("getQbittorrentSnapshot", () => {
  it("logs in with a form body once, then reuses the session", async () => {
    const fetchMock = stubQbit();
    const snap = await getQbittorrentSnapshot(CFG);
    await getQbittorrentSnapshot(CFG);

    expect(snap.downSpeed).toBe(1200);
    expect(snap.upSpeed).toBe(800);

    const logins = loginCalls(fetchMock);
    expect(logins).toHaveLength(1);
    const [, init] = logins[0] as [RequestInfo, RequestInit];
    expect(String(init.body)).toBe("username=admin&password=file-secret");
    expect(
      new Headers(init.headers).get("referer")
    ).toBe("http://qbit.local:8080");

    // Authenticated calls carry the minted cookie.
    const authed = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/v2/transfer/info")
    ) as [RequestInfo, RequestInit];
    expect(new Headers(authed[1].headers).get("cookie")).toBe("SID=abc123");
  });

  it("maps rows, buckets the counts, and caps the list actively-first", async () => {
    const raw = (over: Record<string, unknown>) => ({
      name: "t",
      state: "pausedDL",
      progress: 0.1,
      ratio: 0.5,
      dlspeed: 0,
      upspeed: 0,
      size: 1000,
      eta: 8640000,
      ...over,
    });
    stubQbit({
      torrents: [
        raw({ name: "active-dl", state: "downloading", dlspeed: 5000, progress: 0.3, eta: 3600 }),
        raw({ name: "stalled-dl", state: "stalledDL" }),
        raw({ name: "seeder", state: "uploading", upspeed: 100, progress: 1 }),
        raw({ name: "broken", state: "error", progress: 0.5 }),
        raw({ name: "p1" }),
        raw({ name: "p2" }),
        raw({ name: "p3" }),
        raw({ name: "p4" }),
        raw({ name: "p5" }),
        raw({ name: "done", state: "stoppedUP", progress: 1 }),
      ],
    });
    const snap = await getQbittorrentSnapshot(CFG);

    expect(snap.counts).toEqual({
      total: 10,
      downloading: 2, // downloading + stalledDL
      seeding: 1,
      paused: 6, // pausedDL ×5 + stoppedUP
      errored: 1,
    });
    expect(snap.torrents).toHaveLength(TORRENT_LIST_CAP);
    // Actively transferring first, fastest first.
    expect(snap.torrents[0].name).toBe("active-dl");
    expect(snap.torrents[1].name).toBe("seeder");
    // qBittorrent's 8640000 "no estimate" ETA reads as null.
    expect(snap.torrents[0].eta).toBe(3600);
    expect(snap.torrents[1].eta).toBeNull();
  });

  it("excludes queued and checking torrents from the downloading count", async () => {
    const raw = (state: string) => ({
      name: state,
      state,
      progress: 0,
      ratio: 0,
      dlspeed: 0,
      upspeed: 0,
      size: 1000,
      eta: 0,
    });
    stubQbit({
      torrents: [
        raw("queuedDL"),
        raw("checkingDL"),
        raw("downloading"),
        raw("stalledDL"),
      ],
    });
    const snap = await getQbittorrentSnapshot(CFG);
    expect(snap.counts.total).toBe(4);
    // Only downloading + stalledDL — a queue-capped client at 0 B/s must not
    // read as "2 downloading" when nothing is moving.
    expect(snap.counts.downloading).toBe(2);
  });

  it("accepts a torrent list larger than the default body cap", async () => {
    // ~5 MB of torrents JSON — over the 4 MB default cap, under the raised
    // per-call cap. The default would reject this as "Response too large".
    const big = Array.from({ length: 3500 }, (_, i) => ({
      name: `torrent-${i}-${"x".repeat(1400)}`,
      state: "pausedDL",
      progress: 0,
      ratio: 0,
      dlspeed: 0,
      upspeed: 0,
      size: 1000,
      eta: 0,
    }));
    expect(JSON.stringify(big).length).toBeGreaterThan(4 * 1024 * 1024);
    stubQbit({ torrents: big });
    const snap = await getQbittorrentSnapshot(CFG);
    expect(snap.counts.total).toBe(3500);
  });

  it("re-logins once when the cached session has expired", async () => {
    let logins = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v2/auth/login")) {
        logins += 1;
        return okLogin();
      }
      // The first session is stale: everything 403s until a re-login.
      if (logins < 2) return new Response("Forbidden", { status: 403 });
      if (url.endsWith("/api/v2/app/version")) return new Response("v5.0.1");
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeQbittorrent(CFG);
    expect(result).toEqual({ ok: true, detail: "qBittorrent v5.0.1" });
    expect(logins).toBe(2);
  });

  it("accepts qBittorrent 5.2+'s 204 No Content login", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v2/auth/login")) {
        // qBittorrent 5.2+ answers 204 with an empty body on success; the SID
        // cookie still comes back. The old code threw "Empty response" here.
        return new Response(null, {
          status: 204,
          headers: { "set-cookie": "SID=xyz789; HttpOnly; path=/" },
        });
      }
      if (url.endsWith("/api/v2/app/version")) return new Response("v5.2.0");
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeQbittorrent(CFG);
    expect(result).toEqual({ ok: true, detail: "qBittorrent v5.2.0" });
    // The cookie minted from the 204 is reused on the authenticated call.
    const authed = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/v2/app/version")
    ) as [RequestInfo, RequestInit];
    expect(new Headers(authed[1].headers).get("cookie")).toBe("SID=xyz789");
  });

  it("reports bad credentials in the admin's terms", async () => {
    stubQbit({ badCredentials: true });
    const result = await probeQbittorrent(CFG);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/check the username and password/);
  });

  it("rejects a non-http(s) URL with a message, not a fetch", async () => {
    const fetchMock = stubQbit();
    const result = await probeQbittorrent({ ...CFG, url: "qbit.local:8080" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/http\(s\)/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resolveQbittorrentPassword", () => {
  it("prefers CTRLCENTER_QBITTORRENT_PASS over the stored password", () => {
    vi.stubEnv("CTRLCENTER_QBITTORRENT_PASS", "env-secret");
    expect(resolveQbittorrentPassword({ password: "file-secret" })).toBe(
      "env-secret"
    );
  });

  it("falls back to the stored password when the env var is unset", () => {
    vi.stubEnv("CTRLCENTER_QBITTORRENT_PASS", "");
    expect(resolveQbittorrentPassword({ password: "file-secret" })).toBe(
      "file-secret"
    );
  });
});
