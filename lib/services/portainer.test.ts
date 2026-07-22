import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPortainerSnapshot,
  probePortainer,
  resolvePortainerApiKey,
  mapPortainerEndpoints,
  PORTAINER_ENDPOINT_CAP,
} from "./portainer";

const CFG = { url: "http://portainer.local:9443/", apiKey: "ptr_key" };

const ENDPOINTS = [
  {
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
    Name: "nas",
    Snapshots: [
      { RunningContainerCount: 8, StoppedContainerCount: 0, TotalContainerCount: 8 },
    ],
  },
  { Name: "offline-agent" }, // no snapshot
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
      { name: "local", running: 14, stopped: 2, unhealthy: 1, total: 16, hasSnapshot: true },
      { name: "nas", running: 8, stopped: 0, unhealthy: 0, total: 8, hasSnapshot: true },
      { name: "offline-agent", running: 0, stopped: 0, unhealthy: 0, total: 0, hasSnapshot: false },
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
