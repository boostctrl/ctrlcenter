import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getUnifiSnapshot,
  getUnifiDetail,
  probeUnifi,
  mapUnifiHealth,
  mapUnifiDevices,
  countUnifiDevices,
  countUnifiClients,
  UNIFI_ISSUE_CAP,
  UNIFI_DEVICE_CAP,
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
// proxied health/sysinfo endpoints return their envelopes. The v2 lists
// (bare JSON, no envelope) 404, as on a controller without them, unless given.
function stubUnifiOs(opts: {
  loginStatus?: number;
  health?: unknown;
  sysinfo?: unknown;
  devices?: unknown;
  appDevices?: unknown;
  clients?: unknown;
  healthStatus?: () => number;
} = {}) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
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
    if (url.includes("/proxy/network/api/s/default/stat/device")) {
      return new Response(envelope(opts.devices ?? DEVICES));
    }
    if (url.includes("/proxy/network/v2/api/site/default/device") && opts.appDevices) {
      return new Response(JSON.stringify(opts.appDevices));
    }
    if (url.includes("/proxy/network/v2/api/site/default/clients/active") && opts.clients) {
      return new Response(JSON.stringify(opts.clients));
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// n copies of an object.
const times = <T,>(n: number, item: T): T[] => Array.from({ length: n }, () => item);

// A trimmed stat/device payload: a gateway, two APs (one offline), a switch.
const DEVICES = [
  { name: "Dream Machine", type: "udm", state: 1, num_sta: 25, uptime: 864_000 },
  { name: "Office AP", type: "uap", state: 1, num_sta: 12, uptime: 3600 },
  { name: "Garage AP", type: "uap", state: 0, num_sta: 0, uptime: 0 },
  { name: "Rack Switch", type: "usw", state: 1, num_sta: 8, uptime: 90_000 },
];

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
    // Counted from stat/device: the Garage AP is offline.
    expect(snap.devices).toEqual({ online: 3, disconnected: 1, pending: 0 });
    expect(snap.issues).toEqual([{ level: "error", message: "1 device disconnected" }]);

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

  // #467: the card added up the health subsystems' num_adopted, which count
  // roles. On a live controller with two Dream Machines (each a gateway and a
  // switch or AP), that came to 8 for 6 devices.
  it("counts devices, not the roles the health summary adds up", async () => {
    const devices = ["udm", "udm", "uap", "uap", "usw", "usw"].map((type) => ({ type, state: 1 }));
    stubUnifiOs({ devices });
    const snap = await getUnifiSnapshot(CFG);
    expect(snap.devices).toEqual({ online: 6, disconnected: 0, pending: 0 });
    expect(snap.issues).toEqual([]);
  });

  it("falls back to the health summary's tallies when stat/device fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/api/auth/login"))
          return new Response("{}", { status: 200, headers: { "set-cookie": "TOKEN=jwt; Path=/" } });
        if (url.includes("/stat/health")) return new Response(envelope(HEALTH));
        if (url.includes("/stat/device")) return new Response("<html>oops</html>");
        return new Response("not found", { status: 404 });
      })
    );
    const snap = await getUnifiSnapshot(CFG);
    expect(snap.devices).toEqual({ online: 8, disconnected: 0, pending: 0 });
  });

  // #502: on a live controller the health summary had 15 WiFi clients and
  // UniFi Network's own pages 13, the count its v2 active-client list gives.
  it("counts clients from the active-client list UniFi Network reads", async () => {
    const health = HEALTH.map((s) =>
      s.subsystem === "wlan" ? { ...s, num_user: 15 } : s.subsystem === "lan" ? { ...s, num_user: 7 } : s
    );
    stubUnifiOs({
      health,
      clients: [
        ...times(12, { type: "WIRELESS", is_wired: false, is_guest: false }),
        { type: "WIRELESS", is_wired: false, is_guest: true },
        ...times(7, { type: "WIRED", is_wired: true, is_guest: false }),
      ],
    });
    const snap = await getUnifiSnapshot(CFG);
    expect(snap.clients).toEqual({ total: 20, wireless: 13, wired: 7, guests: 1 });
  });

  // #467: on a live controller UniFi Network showed 8 devices online and 2
  // offline: the 6 network devices in stat/device, and 4 Protect devices
  // from its v2 device list, 2 of them disconnected.
  it("counts other UniFi apps' devices from the v2 device list", async () => {
    const network = ["udm", "udm", "uap", "uap", "usw", "usw"].map((type) => ({ type, state: 1 }));
    stubUnifiOs({
      devices: network,
      appDevices: {
        network_devices: network,
        protect_devices: [{ state: 1 }, { state: 1 }, { state: 0 }, { state: 0 }],
        access_devices: [],
        unmanaged_devices: [{ state: 0 }],
      },
    });
    const snap = await getUnifiSnapshot(CFG);
    expect(snap.devices).toEqual({ online: 8, disconnected: 2, pending: 0 });
    expect(snap.issues).toEqual([{ level: "error", message: "2 devices disconnected" }]);
  });

  it("takes the network gear from the v2 device list when stat/device fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/api/auth/login"))
          return new Response("{}", { status: 200, headers: { "set-cookie": "TOKEN=jwt; Path=/" } });
        if (url.includes("/stat/health")) return new Response(envelope(HEALTH));
        if (url.includes("/v2/api/site/default/device"))
          return new Response(
            JSON.stringify({
              network_devices: [{ type: "udm", state: 1 }, { type: "uap", state: 1 }],
              protect_devices: [{ state: 0 }],
            })
          );
        if (url.includes("/v2/api/site/default/clients/active")) return new Response("<html>oops</html>");
        return new Response("nope", { status: 500 });
      })
    );
    const snap = await getUnifiSnapshot(CFG);
    expect(snap.devices).toEqual({ online: 2, disconnected: 1, pending: 0 });
    // The client list didn't parse: the health summary's counts.
    expect(snap.clients).toEqual({ total: 25, wireless: 17, wired: 8, guests: 0 });
  });
});

describe("countUnifiClients", () => {
  it("counts WiFi, wired and guest clients, by type or else by is_wired", () => {
    expect(
      countUnifiClients([
        { type: "WIRELESS" },
        { type: "WIRELESS", is_guest: true },
        { type: "WIRED", is_guest: true },
        { is_wired: false },
        { is_wired: true },
        // Neither WiFi nor wired, or not a client at all: not counted.
        { type: "VPN", is_guest: true },
        {},
        null,
        "x",
      ])
    ).toEqual({ total: 5, wireless: 3, wired: 2, guests: 2 });
    expect(countUnifiClients([])).toEqual({ total: 0, wireless: 0, wired: 0, guests: 0 });
    expect(countUnifiClients({ data: [] })).toBeNull();
  });
});

describe("countUnifiDevices", () => {
  it("sorts devices by state into online, offline and pending", () => {
    const states = [1, 4, 5, 0, 6, 9, 11, 2, 7];
    const devices = [...states.map((state) => ({ type: "uap", state })), { type: "usw", state: 1, adopted: false }];
    expect(countUnifiDevices(devices)).toEqual({ online: 3, disconnected: 4, pending: 3 });
    expect(countUnifiDevices([])).toEqual({ online: 0, disconnected: 0, pending: 0 });
    expect(countUnifiDevices("nope")).toBeNull();
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
    // No device list: the health summary's tallies.
    expect(snap.devices).toEqual({ online: 6, disconnected: 1, pending: 2 });
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

describe("getUnifiDetail", () => {
  it("adds the device list to the health snapshot, offline gear first", async () => {
    stubUnifiOs();
    const detail = await getUnifiDetail(CFG);
    // Health snapshot still present.
    expect(detail.internet.up).toBe(true);
    // Devices mapped, offline first, with a friendly kind.
    expect(detail.deviceList).toEqual([
      { name: "Garage AP", kind: "Access Point", up: false, clients: 0, uptime: null },
      { name: "Dream Machine", kind: "Gateway", up: true, clients: 25, uptime: 864_000 },
      { name: "Office AP", kind: "Access Point", up: true, clients: 12, uptime: 3600 },
      { name: "Rack Switch", kind: "Switch", up: true, clients: 8, uptime: 90_000 },
    ]);
  });

  it("degrades to an empty device list when stat/device fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/api/auth/login"))
          return new Response("{}", {
            status: 200,
            headers: { "set-cookie": "TOKEN=jwt; Path=/" },
          });
        if (url.includes("/stat/health")) return new Response(envelope(HEALTH));
        if (url.includes("/stat/device")) return new Response("nope", { status: 500 });
        return new Response("not found", { status: 404 });
      })
    );
    const detail = await getUnifiDetail(CFG);
    expect(detail.internet.up).toBe(true);
    expect(detail.deviceList).toEqual([]);
  });

  it("lists other UniFi apps' devices by app, without clients or uptime", async () => {
    stubUnifiOs({
      devices: [{ name: "Dream Machine", type: "udm", state: 1, num_sta: 20, uptime: 600 }],
      appDevices: {
        protect_devices: [
          { name: "Driveway", state: 1, uptime: 123_456_789 },
          { name: "Porch", state: 0 },
        ],
        apollo_devices: [{ name: "Mystery", state: 1 }],
      },
    });
    const detail = await getUnifiDetail(CFG);
    expect(detail.deviceList).toEqual([
      { name: "Porch", kind: "Protect", up: false, clients: null, uptime: null },
      { name: "Dream Machine", kind: "Gateway", up: true, clients: 20, uptime: 600 },
      { name: "Driveway", kind: "Protect", up: true, clients: null, uptime: null },
      { name: "Mystery", kind: "Device", up: true, clients: null, uptime: null },
    ]);
  });
});

describe("mapUnifiDevices", () => {
  it("caps the list and falls back for name and kind", () => {
    const many = Array.from({ length: UNIFI_DEVICE_CAP + 5 }, () => ({
      type: "usw",
      state: 1,
    }));
    expect(mapUnifiDevices(many)).toHaveLength(UNIFI_DEVICE_CAP);
    const [d] = mapUnifiDevices([{ mac: "aa:bb", type: "mystery", state: 0 }]);
    expect(d).toEqual({ name: "aa:bb", kind: "mystery", up: false, clients: 0, uptime: null });
  });

  // #468: the cap ran before the offline-first sort, so offline gear past
  // the 40th device never showed.
  it("keeps offline devices from past the cap", () => {
    const many = Array.from({ length: UNIFI_DEVICE_CAP + 5 }, (_, i) => ({
      name: `dev${i}`,
      type: "uap",
      state: i >= UNIFI_DEVICE_CAP ? 0 : 1,
    }));
    const shown = mapUnifiDevices(many);
    expect(shown).toHaveLength(UNIFI_DEVICE_CAP);
    expect(shown.slice(0, 5).map((d) => [d.name, d.up])).toEqual(
      Array.from({ length: 5 }, (_, i) => [`dev${UNIFI_DEVICE_CAP + i}`, false])
    );
  });
});

