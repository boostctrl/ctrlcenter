import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getUnifiSnapshot,
  probeUnifi,
  resolveUnifiPassword,
  mapUnifiHealth,
  UNIFI_ISSUE_CAP,
} from "./unifi";

const CFG = {
  url: "http://unifi.local:8443/",
  username: "elliott",
  password: "pw",
  allowInsecureTls: false,
};

// A trimmed but real-shaped `stat/health` payload (from a live UDM Pro).
const HEALTH = [
  {
    subsystem: "wlan",
    num_user: 17,
    num_guest: 0,
    num_iot: 1,
    status: "ok",
    num_ap: 3,
    num_adopted: 3,
    num_disconnected: 0,
    num_pending: 0,
  },
  {
    subsystem: "wan",
    num_gw: 1,
    num_adopted: 1,
    num_disconnected: 0,
    status: "ok",
    wan_ip: "149.154.36.47",
    isp_name: "Metronet",
    num_sta: 25,
  },
  { subsystem: "www", status: "ok", latency: 50 },
  {
    subsystem: "lan",
    status: "ok",
    num_user: 8,
    num_guest: 0,
    num_sw: 4,
    num_adopted: 4,
    num_disconnected: 0,
    num_pending: 0,
  },
  { subsystem: "vpn", status: "ok" },
];

const envelope = (data: unknown) => JSON.stringify({ meta: { rc: "ok" }, data });

// Dispatching stub: /api/auth/login (UniFi OS) sets a TOKEN cookie; the
// proxied health/sysinfo endpoints return their envelopes.
function stubUnifiOs(opts: {
  loginStatus?: number;
  health?: unknown;
  sysinfo?: unknown;
  healthStatus?: () => number;
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/auth/login")) {
      const status = opts.loginStatus ?? 200;
      return new Response("{}", {
        status,
        headers: status === 200 ? { "set-cookie": "TOKEN=jwt-abc; Path=/; HttpOnly" } : {},
      });
    }
    if (url.endsWith("/api/login")) {
      // Classic path — this stub is UniFi OS, so pretend it doesn't exist.
      return new Response("not found", { status: 404 });
    }
    if (url.includes("/proxy/network/api/s/default/stat/health")) {
      const status = opts.healthStatus?.() ?? 200;
      if (status !== 200) return new Response("nope", { status });
      return new Response(envelope(opts.health ?? HEALTH));
    }
    if (url.includes("/proxy/network/api/s/default/stat/sysinfo")) {
      return new Response(envelope(opts.sysinfo ?? [{ version: "10.5.62" }]));
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  const g = globalThis as {
    __ctrlcenterUnifiSessions?: Map<string, unknown>;
    __ctrlcenterUnifiLogins?: Map<string, unknown>;
  };
  g.__ctrlcenterUnifiSessions?.clear();
  g.__ctrlcenterUnifiLogins?.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getUnifiSnapshot", () => {
  it("logs into UniFi OS and maps health into the snapshot", async () => {
    const fetchMock = stubUnifiOs();
    const snap = await getUnifiSnapshot(CFG);
    expect(snap.internet).toEqual({
      up: true,
      isp: "Metronet",
      wanIp: "149.154.36.47",
      latencyMs: 50,
    });
    expect(snap.clients).toEqual({ total: 25, wireless: 17, wired: 8, guests: 0 });
    expect(snap.devices).toEqual({ adopted: 8, disconnected: 0, pending: 0 });
    expect(snap.issues).toEqual([]);

    // Logged in once, then fetched health with the returned cookie.
    const loginCall = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith("/api/auth/login")
    );
    expect((loginCall?.[1] as RequestInit)?.method).toBe("POST");
    const healthCall = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("/stat/health")
    );
    const headers = (healthCall?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Cookie).toBe("TOKEN=jwt-abc");
  });

  it("re-logs-in once on a 401, then succeeds", async () => {
    let calls = 0;
    const fetchMock = stubUnifiOs({ healthStatus: () => (++calls === 1 ? 401 : 200) });
    const snap = await getUnifiSnapshot(CFG);
    expect(snap.clients.total).toBe(25);
    // Two logins (initial + after the 401) and two health GETs.
    expect(
      fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/api/auth/login"))
    ).toHaveLength(2);
  });

  it("reports bad credentials from a 401 login", async () => {
    stubUnifiOs({ loginStatus: 401 });
    await expect(getUnifiSnapshot(CFG)).rejects.toThrow(
      "Login failed — check the username and password"
    );
  });
});

describe("mapUnifiHealth", () => {
  it("derives issues from degraded subsystems and offline devices", () => {
    const snap = mapUnifiHealth([
      { subsystem: "wan", status: "error", wan_ip: "1.2.3.4" },
      { subsystem: "www", status: "warning", latency: 120 },
      {
        subsystem: "wlan",
        status: "ok",
        num_user: 4,
        num_adopted: 2,
        num_disconnected: 1,
      },
      { subsystem: "lan", status: "ok", num_user: 3, num_adopted: 4, num_pending: 2 },
    ]);
    expect(snap.internet.up).toBe(false);
    expect(snap.clients.total).toBe(7);
    expect(snap.devices).toEqual({ adopted: 6, disconnected: 1, pending: 2 });
    // Errors sort ahead of warnings.
    expect(snap.issues[0]).toEqual({ level: "error", message: "WAN down" });
    expect(snap.issues).toContainEqual({ level: "error", message: "1 device disconnected" });
    expect(snap.issues).toContainEqual({ level: "warning", message: "Internet degraded" });
    expect(snap.issues).toContainEqual({ level: "warning", message: "2 devices pending adoption" });
  });

  it("caps the issue list", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      subsystem: `x${i}`,
      status: "warning",
    }));
    expect(mapUnifiHealth(many).issues).toHaveLength(UNIFI_ISSUE_CAP);
  });
});

describe("probeUnifi", () => {
  it("names the UniFi Network version that answered", async () => {
    stubUnifiOs();
    expect(await probeUnifi(CFG)).toEqual({ ok: true, detail: "UniFi Network 10.5.62" });
  });

  it("folds bad credentials into the result shape", async () => {
    stubUnifiOs({ loginStatus: 401 });
    expect(await probeUnifi(CFG)).toEqual({
      ok: false,
      error: "Login failed — check the username and password",
    });
  });
});

describe("resolveUnifiPassword", () => {
  it("prefers the env var over the stored password", () => {
    vi.stubEnv("CTRLCENTER_UNIFI_PASS", "env-pw");
    expect(resolveUnifiPassword({ password: "stored" })).toBe("env-pw");
  });

  it("falls back to the stored password when the env var is unset", () => {
    vi.stubEnv("CTRLCENTER_UNIFI_PASS", "");
    expect(resolveUnifiPassword({ password: "stored" })).toBe("stored");
  });
});
