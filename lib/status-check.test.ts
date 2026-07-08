import { describe, it, expect, vi, afterEach } from "vitest";
import net from "node:net";
import dnsPromises from "node:dns/promises";
import { checkApp } from "./status-check";

afterEach(() => {
  vi.restoreAllMocks();
});

// A real Response so the body-capped read path (headers + stream) is exercised.
function mockFetch(status: number, body = "") {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(body, { status }));
}

const base = { expectStatus: "", keyword: "" } as const;

describe("checkApp · http", () => {
  it("is up on a reachable host", async () => {
    mockFetch(200);
    const r = await checkApp({ ...base, url: "https://x.example", checkType: "http" });
    expect(r.up).toBe(true);
    expect(r.status).toBe(200);
  });

  it("honours expectStatus", async () => {
    mockFetch(404);
    const r = await checkApp({
      ...base,
      url: "https://x.example",
      checkType: "http",
      expectStatus: "200-299",
    });
    expect(r.up).toBe(false);
    expect(r.status).toBe(404);
  });

  it("is down on a network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    const r = await checkApp({ ...base, url: "https://x.example", checkType: "http" });
    expect(r.up).toBe(false);
    expect(r.status).toBeNull();
  });
});

describe("checkApp · keyword", () => {
  it("is up when the body contains the keyword", async () => {
    mockFetch(200, "<title>Grafana</title>");
    const r = await checkApp({
      ...base,
      url: "https://x.example",
      checkType: "keyword",
      keyword: "grafana",
    });
    expect(r.up).toBe(true);
  });

  it("is down when the keyword is missing", async () => {
    mockFetch(200, "<title>nope</title>");
    const r = await checkApp({
      ...base,
      url: "https://x.example",
      checkType: "keyword",
      keyword: "grafana",
    });
    expect(r.up).toBe(false);
  });

  it("is down when the body exceeds the size cap", async () => {
    // Stream 3 × 1 MB chunks with no content-length so the 2 MB cap trips while
    // reading — a miss even though the keyword is in the first chunk.
    const megabyte = 1024 * 1024;
    const first = new TextEncoder().encode(
      "grafana".padEnd(megabyte, "a")
    );
    const filler = new Uint8Array(megabyte).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(first);
        c.enqueue(filler);
        c.enqueue(filler);
        c.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, { status: 200 })
    );
    const r = await checkApp({
      ...base,
      url: "https://x.example",
      checkType: "keyword",
      keyword: "grafana",
    });
    expect(r.up).toBe(false);
    expect(r.status).toBe(200);
  });
});

describe("checkApp · tcp", () => {
  it("is up when the port is open", async () => {
    const server = net.createServer();
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const r = await checkApp({
        ...base,
        url: "http://127.0.0.1",
        checkType: "tcp",
        port,
      });
      expect(r.up).toBe(true);
    } finally {
      server.close();
    }
  });

  it("is down when the port is closed", async () => {
    const r = await checkApp({
      ...base,
      url: "http://127.0.0.1",
      checkType: "tcp",
      port: 1,
    });
    expect(r.up).toBe(false);
  });
});

describe("checkApp · dns", () => {
  it("is up when the host resolves", async () => {
    const r = await checkApp({ ...base, url: "http://localhost", checkType: "dns" });
    expect(r.up).toBe(true);
  });

  it("is down when resolution fails", async () => {
    // Some resolvers hijack bogus TLDs, so force a failure rather than relying
    // on a name genuinely not resolving.
    vi.spyOn(dnsPromises, "lookup").mockRejectedValue(new Error("ENOTFOUND"));
    const r = await checkApp({ ...base, url: "http://example.com", checkType: "dns" });
    expect(r.up).toBe(false);
  });
});
