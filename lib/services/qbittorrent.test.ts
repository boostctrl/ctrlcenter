import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyMaindata,
  getQbittorrentSnapshot,
  probeQbittorrent,
  resolveQbittorrentPassword,
  simplifyTorrentState,
  TORRENT_LIST_CAP,
  type QbitSyncState,
} from "./qbittorrent";

const CFG = {
  url: "http://qbit.local:8080",
  username: "admin",
  password: "file-secret",
};

// The session-cookie cache and the maindata sync state both live on globalThis
// and survive across tests; reset all of it between tests.
function clearQbitState() {
  const g = globalThis as {
    __ctrlcenterQbitSessions?: Map<string, unknown>;
    __ctrlcenterQbitSync?: Map<string, unknown>;
    __ctrlcenterQbitSyncLocks?: Map<string, unknown>;
  };
  g.__ctrlcenterQbitSessions?.clear();
  g.__ctrlcenterQbitSync?.clear();
  g.__ctrlcenterQbitSyncLocks?.clear();
}

const okLogin = () =>
  new Response("Ok.", {
    headers: { "set-cookie": "SID=abc123; HttpOnly; path=/" },
  });

// Dispatching fetch stub for the WebUI endpoints a snapshot/probe touches. The
// snapshot polls /sync/maindata; the stub answers with a full update carrying
// the given torrents (keyed into a map) and server_state, mirroring qBittorrent.
function stubQbit({
  torrents = [] as unknown[],
  transfer = { dl_info_speed: 1200, up_info_speed: 800 },
  badCredentials = false,
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v2/auth/login")) {
      return badCredentials ? new Response("Fails.") : okLogin();
    }
    if (url.includes("/api/v2/sync/maindata")) {
      const map = Object.fromEntries(torrents.map((t, i) => [`h${i}`, t]));
      return new Response(
        JSON.stringify({ rid: 1, full_update: true, torrents: map, server_state: transfer })
      );
    }
    if (url.includes("/api/v2/app/version")) return new Response("v5.0.1");
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const loginCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([input]) =>
    String(input).includes("/api/v2/auth/login")
  );

beforeEach(clearQbitState);
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
      String(input).includes("/api/v2/sync/maindata")
    ) as [RequestInfo, RequestInit];
    expect(new Headers(authed[1].headers).get("cookie")).toBe("SID=abc123");
  });

  it("polls maindata incrementally, advancing the rid across snapshots", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v2/auth/login")) return okLogin();
      if (url.includes("/api/v2/sync/maindata")) {
        const rid = new URL(url).searchParams.get("rid");
        // First poll (rid 0) is a full sync; the next carries only a delta.
        if (rid === "0") {
          return new Response(
            JSON.stringify({
              rid: 4,
              full_update: true,
              torrents: {
                a: { name: "A", state: "downloading", dlspeed: 10, progress: 0.1 },
              },
              server_state: { dl_info_speed: 10, up_info_speed: 0 },
            })
          );
        }
        return new Response(
          JSON.stringify({
            rid: 5,
            torrents: { a: { dlspeed: 99 } },
            server_state: { dl_info_speed: 99 },
          })
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await getQbittorrentSnapshot(CFG);
    expect(first.downSpeed).toBe(10);
    const second = await getQbittorrentSnapshot(CFG);
    // The delta merged over the retained torrent: one torrent still, new speed.
    expect(second.downSpeed).toBe(99);
    expect(second.counts.total).toBe(1);
    // The second request advanced to the rid the first response returned.
    const mainCalls = fetchMock.mock.calls.filter(([i]) =>
      String(i).includes("/api/v2/sync/maindata")
    );
    expect(mainCalls).toHaveLength(2);
    expect(String(mainCalls[0][0])).toContain("rid=0");
    expect(String(mainCalls[1][0])).toContain("rid=4");
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

  it("captures qBittorrent 5.2's renamed QBT_SID_<port> cookie and replays it", async () => {
    // 5.2 answers 204 and names the session cookie QBT_SID_<port> (not SID).
    // The data calls 403 unless that exact cookie is sent back verbatim.
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v2/auth/login")) {
        return new Response(null, {
          status: 204,
          headers: { "set-cookie": "QBT_SID_8080=tok9; HttpOnly; SameSite=Strict" },
        });
      }
      const cookie = new Headers(init?.headers).get("cookie");
      if (cookie !== "QBT_SID_8080=tok9") {
        return new Response("Forbidden", { status: 403 });
      }
      if (url.includes("/api/v2/sync/maindata")) {
        return new Response(
          JSON.stringify({
            rid: 1,
            full_update: true,
            torrents: {},
            server_state: { dl_info_speed: 9, up_info_speed: 4 },
          })
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const snap = await getQbittorrentSnapshot(CFG);
    expect(snap.downSpeed).toBe(9);
    const authed = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/api/v2/sync/maindata")
    ) as [RequestInfo, RequestInit];
    expect(new Headers(authed[1].headers).get("cookie")).toBe("QBT_SID_8080=tok9");
  });

  it("proceeds without a cookie when the WebUI bypasses authentication", async () => {
    // qBittorrent with "Bypass authentication for clients on localhost /
    // whitelisted subnets" returns a successful login with NO Set-Cookie. The
    // old code failed here ("Login succeeded but no session cookie came back").
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v2/auth/login")) return new Response("Ok.");
      if (url.includes("/api/v2/sync/maindata")) {
        return new Response(
          JSON.stringify({
            rid: 1,
            full_update: true,
            torrents: {},
            server_state: { dl_info_speed: 5, up_info_speed: 2 },
          })
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const snap = await getQbittorrentSnapshot(CFG);
    expect(snap.downSpeed).toBe(5);
    // The authenticated calls carry no Cookie header (there is no session).
    const authed = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/api/v2/sync/maindata")
    ) as [RequestInfo, RequestInit];
    expect(new Headers(authed[1].headers).get("cookie")).toBeNull();
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

describe("applyMaindata", () => {
  const torrent = (over: Record<string, unknown> = {}) => ({
    name: "t",
    state: "downloading",
    progress: 0.5,
    dlspeed: 10,
    ...over,
  });

  const full = (over: Partial<QbitSyncState> = {}): QbitSyncState =>
    applyMaindata(null, {
      rid: 1,
      full_update: true,
      torrents: { a: torrent({ name: "A", dlspeed: 10, progress: 0.2 }) },
      server_state: { dl_info_speed: 100, up_info_speed: 5 },
      ...(over as object),
    });

  it("initializes from a cold prior as a full sync", () => {
    const state = full();
    expect(state.rid).toBe(1);
    expect([...state.torrents.keys()]).toEqual(["a"]);
    expect(state.torrents.get("a")?.name).toBe("A");
    expect(state.serverState).toMatchObject({ dl_info_speed: 100, up_info_speed: 5 });
  });

  it("merges a partial torrent update over the last-known object", () => {
    const next = applyMaindata(full(), {
      rid: 2,
      torrents: { a: { dlspeed: 50 }, b: torrent({ name: "B" }) },
      server_state: { dl_info_speed: 200 },
    });
    expect(next.rid).toBe(2);
    // `a` keeps its untouched fields; only dlspeed changed.
    expect(next.torrents.get("a")).toMatchObject({
      name: "A",
      progress: 0.2,
      dlspeed: 50,
    });
    expect(next.torrents.get("b")?.name).toBe("B");
    // server_state merges: the untouched up_info_speed survives.
    expect(next.serverState).toMatchObject({ dl_info_speed: 200, up_info_speed: 5 });
  });

  it("drops torrents listed in torrents_removed", () => {
    const prev = applyMaindata(null, {
      rid: 1,
      full_update: true,
      torrents: { a: torrent(), b: torrent() },
    });
    const next = applyMaindata(prev, { rid: 2, torrents_removed: ["a"] });
    expect([...next.torrents.keys()]).toEqual(["b"]);
  });

  it("resets the map on a later full_update", () => {
    const next = applyMaindata(full(), {
      rid: 5,
      full_update: true,
      torrents: { c: torrent({ name: "C" }) },
    });
    expect([...next.torrents.keys()]).toEqual(["c"]);
  });

  it("carries the prior rid forward when a response omits it", () => {
    const prev = applyMaindata(null, { rid: 7, full_update: true, torrents: {} });
    expect(applyMaindata(prev, { torrents: {} }).rid).toBe(7);
  });
});
