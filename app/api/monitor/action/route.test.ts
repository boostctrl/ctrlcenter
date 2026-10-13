import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import * as YAML from "js-yaml";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";

// The action guard (#289): every gate before a dashboard action reaches a
// service, and the shape of the ids it carries there (#379). Only a
// well-formed action gets as far as the (stubbed) network.
let POST: typeof import("./route").POST;
let configPath: string;
let session: string;

async function writeIntegrations(integrations: Record<string, Record<string, unknown>>) {
  await fs.writeFile(configPath, YAML.dump({ settings: { integrations } }), "utf8");
}

const act = (body: unknown, auth = true) =>
  POST(request("/api/monitor/action", { method: "POST", body, session: auth ? session : undefined }));

// Real-shaped ids: a v1 info-hash, a v2 one, and a full Docker container id.
const HASH = "c9e15763f722f23e98a29decdfae341b98d53056";
const HASH_V2 = "6ad1e3f2b1d3c6c8b0a5f4e3d2c1b0a99887766554433221100ffeeddccbbaa9";
const CONTAINER = "4a3f1b2c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a";

// A 2.x-shaped config migrates each service's key to an integration with that
// id (#300).
const pause = { integration: "qbittorrent", service: "qbittorrent", action: "pause", hash: HASH };
const start = {
  integration: "portainer",
  service: "portainer",
  action: "start",
  endpoint: 2,
  container: CONTAINER,
};

// Answers every request as the services would — qBittorrent's login with a
// session cookie, any action with an empty success — and records them.
function stubServices() {
  const fetchMock = vi.fn<typeof fetch>(async (input) =>
    String(input).endsWith("/api/v2/auth/login")
      ? new Response("Ok.", { headers: { "set-cookie": "SID=s; path=/" } })
      : new Response(null, { status: 204 })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeAll(async () => {
  configPath = await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  ({ POST } = await import("./route"));
  session = await adminSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/monitor/action", () => {
  it("requires a session", async () => {
    await writeIntegrations({ qbittorrent: { enabled: true, url: "http://qb.lan", allowActions: true } });
    expect((await act(pause, false)).status).toBe(401);
  });

  it("rejects an unknown action", async () => {
    expect((await act({ ...pause, action: "format-disk" })).status).toBe(400);
    expect((await act({ service: "qbittorrent", action: "pause", hash: HASH })).status).toBe(400);
  });

  it("refuses an integration that isn't configured (409)", async () => {
    await writeIntegrations({ qbittorrent: { enabled: false } });
    expect((await act(pause)).status).toBe(409);
  });

  it("refuses actions until the admin opts in (403)", async () => {
    await writeIntegrations({ qbittorrent: { enabled: true, url: "http://qb.lan", allowActions: false } });
    const res = await act(pause);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not enabled/);
  });

  it("refuses actions while two-factor authentication is off, even opted in (#367)", async () => {
    await writeIntegrations({ qbittorrent: { enabled: true, url: "http://qb.lan", allowActions: true } });
    const res = await act(pause);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/two-factor/);
  });
});

describe("POST /api/monitor/action target ids (#379)", () => {
  beforeAll(async () => {
    await writeIntegrations({
      qbittorrent: { enabled: true, url: "http://qb.lan", allowActions: true },
      portainer: { enabled: true, url: "http://portainer.lan", apiKey: "k", allowActions: true },
    });
    // Actions need the second factor on (#367); the session is fresh, so the
    // destructive verbs' step-up (#366) passes too.
    const { activateTotp } = await import("@/lib/config");
    await activateTotp("JBSWY3DPEHPK3PXP", []);
  });

  it("refuses anything but a container id, before any request", async () => {
    const fetchMock = stubServices();
    for (const container of [
      // A start that became POST …/docker/volumes/prune.
      "x/../../volumes/prune?filters=&",
      "../../volumes/prune",
      `${CONTAINER}/json?`,
      `${CONTAINER}?signal=KILL`,
      "abc/def",
      "my-container",
      "z".repeat(64),
      CONTAINER.slice(0, 20),
      CONTAINER.toUpperCase(),
      "",
    ]) {
      expect((await act({ ...start, container })).status, container).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses anything but an info-hash, before any request", async () => {
    const fetchMock = stubServices();
    // "all" and "a|b" are qBittorrent selectors for every / several torrents.
    for (const hash of ["all", `${HASH}|${HASH_V2}`, `${HASH}/../x`, `${HASH}?`, "g".repeat(40), "abc"]) {
      expect((await act({ ...pause, hash })).status, hash).toBe(400);
      expect((await act({ ...pause, action: "delete", hash, deleteFiles: true })).status, hash).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("acts on a real container id, full or short", async () => {
    const fetchMock = stubServices();
    expect((await act(start)).status).toBe(200);
    expect((await act({ ...start, action: "stop", container: CONTAINER.slice(0, 12) })).status).toBe(200);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `http://portainer.lan/api/endpoints/2/docker/containers/${CONTAINER}/start`,
      `http://portainer.lan/api/endpoints/2/docker/containers/${CONTAINER.slice(0, 12)}/stop`,
    ]);
  });

  it("acts on a real info-hash, v1 or v2, either case", async () => {
    const fetchMock = stubServices();
    for (const hash of [HASH, HASH.toUpperCase(), HASH_V2]) {
      expect((await act({ ...pause, hash })).status, hash).toBe(200);
    }
    const sent = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/api/v2/torrents/stop"))
      .map(([, init]) => String(init?.body));
    expect(sent).toEqual([`hashes=${HASH}`, `hashes=${HASH.toUpperCase()}`, `hashes=${HASH_V2}`]);
  });
});
