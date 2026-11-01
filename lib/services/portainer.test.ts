import { afterEach, describe, expect, it, vi } from "vitest";
import {
  containerLogs,
  DockerLogTail,
  getPortainerSnapshot,
  listContainers,
  mapContainers,
  probePortainer,
  restartContainer,
  startContainer,
  stopContainer,
  mapPortainerEndpoints,
  PORTAINER_ENDPOINT_CAP,
  PORTAINER_LOG_MAX_BYTES,
  PORTAINER_LOG_READ_MAX_BYTES,
} from "./portainer";

const CFG = { url: "http://portainer.local:9443/", apiKey: "ptr_key" };

// Build a multiplexed Docker log frame: [stream, 0,0,0, size(4 BE)] + payload.
function frame(stream: number, text: string | Buffer): Buffer<ArrayBuffer> {
  const payload = typeof text === "string" ? Buffer.from(text, "utf8") : text;
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

// Demux a body in one go (or in `chunks` pieces), keeping the last `window`
// bytes — the whole body by default, so nothing is dropped.
function demux(body: Buffer, opts: { window?: number; chunks?: number[] } = {}): string {
  const tail = new DockerLogTail(opts.window ?? body.length);
  let at = 0;
  for (const n of opts.chunks ?? []) {
    tail.push(body.subarray(at, at + n));
    at += n;
  }
  tail.push(body.subarray(at));
  return tail.text();
}

// A fetch whose body streams `pieces` one read at a time, counting the reads.
function streamingFetch(pieces: () => Uint8Array | null) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      const piece = pieces();
      if (piece === null) controller.close();
      else controller.enqueue(piece);
    },
  });
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(body)));
  return { pulled: () => pulled };
}

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
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
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
    const fetchMock = vi.fn<typeof fetch>(async () =>
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
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status }));
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

  it("keeps the container id inside its path segment (#379)", async () => {
    const fetchMock = capture();
    await startContainer(CFG, 2, "x/../../volumes/prune?");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://portainer.local:9443/api/endpoints/2/docker/containers/x%2F..%2F..%2Fvolumes%2Fprune%3F/start"
    );
  });
});

describe("DockerLogTail", () => {
  it("concatenates the payloads of multiplexed frames", () => {
    const buf = Buffer.concat([
      frame(1, "hello\n"),
      frame(2, "an error\n"),
      frame(1, "bye\n"),
    ]);
    expect(demux(buf)).toBe("hello\nan error\nbye\n");
  });

  it("demuxes a frame split across chunks, header included (#427)", () => {
    const buf = Buffer.concat([frame(1, "first line\n"), frame(2, "second line\n")]);
    // Every possible split point, and a one-byte dribble, give the same text.
    for (let at = 1; at < buf.length; at++) {
      expect(demux(buf, { chunks: [at] })).toBe("first line\nsecond line\n");
    }
    expect(demux(buf, { chunks: Array(buf.length - 1).fill(1) })).toBe(
      "first line\nsecond line\n"
    );
  });

  it("keeps the end of a tail over the window, never more than the window", () => {
    const window = 1024;
    const line = (i: number) => `line ${String(i).padStart(4, "0")} of a long tail\n`;
    const frames: Buffer[] = [];
    for (let i = 0; i < 200; i++) frames.push(frame(i % 2 ? 2 : 1, line(i)));
    const body = Buffer.concat(frames);
    const all = frames.map((f) => f.subarray(8).toString("utf8")).join("");
    expect(all.length).toBeGreaterThan(window * 4);
    // In one push, and in chunks that split headers and payloads alike.
    for (const chunks of [[], Array(Math.floor(body.length / 7)).fill(7)]) {
      const text = demux(body, { window, chunks });
      expect(text).toBe(all.slice(all.length - window));
      expect(text.endsWith(line(199))).toBe(true);
    }
  });

  it("starts the window on a whole character when the cut lands inside one", () => {
    // "é€x" is 2 + 3 + 1 bytes; a 5-byte window drops the first byte of "é",
    // whose continuation byte is skipped rather than decoded as U+FFFD.
    expect(demux(frame(1, "é€x"), { window: 5 })).toBe("€x");
  });

  it("returns a raw (TTY) stream verbatim, however it is chunked", () => {
    // A TTY container's logs aren't framed; the first byte is ordinary text.
    const raw = Buffer.from("plain log line\nno framing here\n", "utf8");
    expect(demux(raw)).toBe("plain log line\nno framing here\n");
    expect(demux(raw, { chunks: [3, 9, 1] })).toBe("plain log line\nno framing here\n");
    expect(demux(raw, { window: 8 })).toBe("ng here\n");
  });

  it("keeps a trailing run shorter than a header as raw tail", () => {
    const buf = Buffer.concat([frame(1, "whole\n"), Buffer.from("end", "utf8")]);
    expect(demux(buf)).toBe("whole\nend");
    expect(demux(buf, { chunks: [buf.length - 2] })).toBe("whole\nend");
  });
});

describe("containerLogs", () => {
  it("fetches a capped, de-multiplexed tail", async () => {
    const framed = frame(1, "line one\nline two\n");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(framed));
    vi.stubGlobal("fetch", fetchMock);
    const out = await containerLogs(CFG, 2, "cid");
    expect(out).toBe("line one\nline two\n");
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/endpoints/2/docker/containers/cid/logs?stdout=1&stderr=1&timestamps=0&tail="
    );
  });

  it("keeps the container id inside its path segment (#379)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(""));
    vi.stubGlobal("fetch", fetchMock);
    await containerLogs(CFG, 2, "abc/json?");
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/endpoints/2/docker/containers/abc%2Fjson%3F/logs?"
    );
  });

  it("won't follow a redirect to another host with the API key (#389)", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 302, headers: { location: "https://sso.example.com/" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(containerLogs(CFG, 2, "cid")).rejects.toThrow("Redirected to another host — check the URL");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the end of a tail far over the window instead of refusing it (#427)", async () => {
    // 200 frames of 64 KiB — a 12.5 MiB tail, three times the service body
    // cap that #402 refused it at — streamed in pieces that split frames and
    // headers. The whole body is read, and the last 256 KiB of text comes
    // back, ending where the container's output ends.
    const body = Buffer.concat(
      Array.from({ length: 200 }, (_, i) => {
        const line = Buffer.alloc(64 * 1024, 0x61 + (i % 26));
        line[line.length - 1] = 0x0a;
        return frame(1, line);
      })
    );
    const piece = 100_000;
    let at = 0;
    const { pulled } = streamingFetch(() => {
      if (at >= body.length) return null;
      const next = body.subarray(at, at + piece);
      at += piece;
      return next;
    });
    const out = await containerLogs(CFG, 2, "cid");
    expect(pulled()).toBe(Math.ceil(body.length / piece) + 1);
    expect(out).toHaveLength(PORTAINER_LOG_MAX_BYTES);
    // The last four lines whole (one 64 KiB line is a quarter of the window),
    // ending on the final line's newline.
    const last = (i: number) => String.fromCharCode(0x61 + (i % 26)).repeat(64 * 1024 - 1) + "\n";
    expect(out).toBe(last(196) + last(197) + last(198) + last(199));
  });

  it("stops reading a body past the hard bound and refuses it (#427)", async () => {
    // A body that never ends: the read stops at PORTAINER_LOG_READ_MAX_BYTES
    // instead of running to the timeout, and the admin sees the same message
    // as for any oversized service response.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const chunk = new Uint8Array(1024 * 1024).fill(0x61);
    const { pulled } = streamingFetch(() => chunk);
    await expect(containerLogs(CFG, 2, "cid")).rejects.toThrow("Response too large");
    // The chunk past the bound tips it, and at most one more was read ahead.
    const bound = PORTAINER_LOG_READ_MAX_BYTES / chunk.length;
    expect(pulled()).toBeGreaterThan(bound);
    expect(pulled()).toBeLessThanOrEqual(bound + 2);
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

