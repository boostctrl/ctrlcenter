import { afterEach, describe, expect, it, vi } from "vitest";
import {
  containerLogs,
  demuxDockerLog,
  getPortainerSnapshot,
  listContainers,
  mapContainers,
  probePortainer,
  resolvePortainerApiKey,
  restartContainer,
  startContainer,
  stopContainer,
  mapPortainerEndpoints,
  PORTAINER_ENDPOINT_CAP,
} from "./portainer";

const CFG = { url: "http://portainer.local:9443/", apiKey: "ptr_key" };

const ENDPOINTS = [
  {
    Id: 1,
    Name: "local",
    Snapshots: [
      {
        RunningContainerCount: 14,
        StoppedContainerCount: 2,
        UnhealthyContainerCount: 1,
        TotalContainerCount: 16,
      },
    ],
  },
  {
    Id: 2,
    Name: "nas",
    Snapshots: [
      { RunningContainerCount: 8, StoppedContainerCount: 0, TotalContainerCount: 8 },
    ],
  },
  { Id: 3, Name: "offline-agent" }, // no snapshot
];

function stubApi(opts: { endpoints?: unknown; fail?: (url: string) => number | null }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const failStatus = opts.fail?.(url) ?? null;
    if (failStatus) return new Response("nope", { status: failStatus });
    if (url.includes("/api/endpoints")) {
      return new Response(JSON.stringify(opts.endpoints ?? ENDPOINTS));
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

describe("getPortainerSnapshot", () => {
  it("groups per environment and totals across them", async () => {
    const fetchMock = stubApi({});
    const snap = await getPortainerSnapshot(CFG);
    expect(snap.endpoints).toEqual([
      { id: 1, name: "local", running: 14, stopped: 2, unhealthy: 1, total: 16, hasSnapshot: true },
      { id: 2, name: "nas", running: 8, stopped: 0, unhealthy: 0, total: 8, hasSnapshot: true },
      { id: 3, name: "offline-agent", running: 0, stopped: 0, unhealthy: 0, total: 0, hasSnapshot: false },
    ]);
    expect(snap.totals).toEqual({ running: 22, stopped: 2, unhealthy: 1, total: 24 });
    // The key rides X-API-Key.
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers["X-API-Key"]).toBe("ptr_key");
  });

  it("maps a 401 to an invalid-key message", async () => {
    stubApi({ fail: () => 401 });
    await expect(getPortainerSnapshot(CFG)).rejects.toThrow("Invalid API key");
  });
});

describe("mapPortainerEndpoints", () => {
  it("caps the environment list and derives total when absent", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      Name: `env${i}`,
      Snapshots: [{ RunningContainerCount: 1, StoppedContainerCount: 1 }],
    }));
    const snap = mapPortainerEndpoints(many);
    expect(snap.endpoints).toHaveLength(PORTAINER_ENDPOINT_CAP);
    // No TotalContainerCount in the snapshot → running + stopped.
    expect(snap.endpoints[0].total).toBe(2);
  });

  it("names an unnamed environment and tolerates a non-array", () => {
    expect(mapPortainerEndpoints(null).endpoints).toEqual([]);
    expect(mapPortainerEndpoints([{ Snapshots: [{}] }]).endpoints[0].name).toBe(
      "Environment 1"
    );
  });
});

describe("mapContainers", () => {
  it("strips Docker's leading slash and tolerates a non-array", () => {
    expect(mapContainers(null)).toEqual([]);
    expect(
      mapContainers([
        { Id: "abc", Names: ["/whoami"], State: "running", Status: "Up 3 hours" },
        { Id: "def", Names: ["/db"], State: "exited", Status: "Exited (0) 1h ago" },
      ])
    ).toEqual([
      { id: "abc", name: "whoami", state: "running", status: "Up 3 hours" },
      { id: "def", name: "db", state: "exited", status: "Exited (0) 1h ago" },
    ]);
  });
});

describe("listContainers", () => {
  it("fetches one environment's containers with the key", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ Id: "x", Names: ["/app"], State: "running" }]))
    );
    vi.stubGlobal("fetch", fetchMock);
    const list = await listContainers(CFG, 2);
    expect(list[0]).toMatchObject({ id: "x", name: "app" });
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo, RequestInit];
    expect(String(url)).toBe(
      "http://portainer.local:9443/api/endpoints/2/docker/containers/json?all=1"
    );
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("ptr_key");
  });
});

describe("container actions", () => {
  // 204/304 are null-body statuses — a Response constructed with a body throws.
  const capture = (status = 204) => {
    const fetchMock = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("POSTs start/stop/restart to the container's Docker endpoint", async () => {
    for (const [fn, verb] of [
      [startContainer, "start"],
      [stopContainer, "stop"],
      [restartContainer, "restart"],
    ] as const) {
      const fetchMock = capture();
      await fn(CFG, 2, "cid9");
      const [url, init] = fetchMock.mock.calls[0] as [RequestInfo, RequestInit];
      expect(String(url)).toBe(
        `http://portainer.local:9443/api/endpoints/2/docker/containers/cid9/${verb}`
      );
      expect(init.method).toBe("POST");
    }
  });

  it("treats Docker's 304 (already in target state) as success", async () => {
    capture(304);
    await expect(startContainer(CFG, 1, "cid")).resolves.toBeUndefined();
  });

  it("maps a 403 to an invalid-key message", async () => {
    capture(403);
    await expect(stopContainer(CFG, 1, "cid")).rejects.toThrow("Invalid API key");
  });
});

describe("demuxDockerLog", () => {
  // Build a multiplexed frame: [stream, 0,0,0, size(4 BE)] + payload.
  function frame(stream: number, text: string): Buffer {
    const payload = Buffer.from(text, "utf8");
    const header = Buffer.alloc(8);
    header[0] = stream;
    header.writeUInt32BE(payload.length, 4);
    return Buffer.concat([header, payload]);
  }

  it("concatenates the payloads of multiplexed frames", () => {
    const buf = Buffer.concat([
      frame(1, "hello\n"),
      frame(2, "an error\n"),
      frame(1, "bye\n"),
    ]);
    expect(demuxDockerLog(buf)).toBe("hello\nan error\nbye\n");
  });

  it("returns a raw (TTY) stream verbatim", () => {
    // A TTY container's logs aren't framed; the first byte is ordinary text.
    const raw = Buffer.from("plain log line\nno framing here\n", "utf8");
    expect(demuxDockerLog(raw)).toBe("plain log line\nno framing here\n");
  });
});

describe("containerLogs", () => {
  it("fetches a capped, de-multiplexed tail", async () => {
    const framed = (() => {
      const payload = Buffer.from("line one\nline two\n", "utf8");
      const header = Buffer.alloc(8);
      header[0] = 1;
      header.writeUInt32BE(payload.length, 4);
      return Buffer.concat([header, payload]);
    })();
    const fetchMock = vi.fn(async () => new Response(framed));
    vi.stubGlobal("fetch", fetchMock);
    const out = await containerLogs(CFG, 2, "cid");
    expect(out).toBe("line one\nline two\n");
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/endpoints/2/docker/containers/cid/logs?stdout=1&stderr=1&timestamps=0&tail="
    );
  });
});

describe("probePortainer", () => {
  it("names the environment count that answered", async () => {
    stubApi({});
    expect(await probePortainer(CFG)).toEqual({
      ok: true,
      detail: "Portainer — 3 environments",
    });
  });

  it("folds an unreachable service into the result shape", async () => {
    stubApi({ fail: () => 502 });
    expect(await probePortainer(CFG)).toEqual({ ok: false, error: "HTTP 502" });
  });
});

describe("resolvePortainerApiKey", () => {
  it("prefers the env var over the stored key", () => {
    vi.stubEnv("CTRLCENTER_PORTAINER_KEY", "env-key");
    expect(resolvePortainerApiKey({ apiKey: "stored" })).toBe("env-key");
  });

  it("falls back to the stored key when the env var is unset", () => {
    vi.stubEnv("CTRLCENTER_PORTAINER_KEY", "");
    expect(resolvePortainerApiKey({ apiKey: "stored" })).toBe("stored");
  });
});
