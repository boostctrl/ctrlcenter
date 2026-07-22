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
