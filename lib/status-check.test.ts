import { describe, it, expect, vi, afterEach } from "vitest";
import net from "node:net";
import dnsPromises from "node:dns/promises";
import { checkApp } from "./status-check";

// Whether this host can bind IPv6 loopback at all. Some containers and CI
// sandboxes can't (listen → EAFNOSUPPORT), and the IPv6-literal test below
// should skip there rather than hang until its timeout (#249).
const hasIPv6Loopback = await new Promise<boolean>((resolve) => {
  const probe = net.createServer();
  probe.once("error", () => resolve(false));
  probe.listen(0, "::1", () => probe.close(() => resolve(true)));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// A real Response so the body-capped read path (headers + stream) is exercised.
function mockFetch(status: number, body = "") {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(body, { status }));
}

// Stub node:dns/promises Resolver so `new dns.Resolver()` yields an object whose
// setServers/resolve4 the test controls — DNS tests never touch the network.
function mockResolver(resolve4: ReturnType<typeof vi.fn>) {
  const setServers = vi.fn();
  // A plain function (not an arrow) so `new dns.Resolver()` can construct it.
  vi.spyOn(dnsPromises, "Resolver").mockImplementation(function () {
    return { setServers, resolve4 } as unknown as InstanceType<
      typeof dnsPromises.Resolver
    >;
  });
  return { setServers, resolve4 };
}

// A rejected resolve4 carrying a c-ares-style error code.
function dnsError(code: string) {
  return Object.assign(new Error(code), { code });
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

  it("does not fall back to GET when HEAD already answers", async () => {
    const spy = mockFetch(200);
    const r = await checkApp({ ...base, url: "https://x.example", checkType: "http" });
    expect(r.up).toBe(true);
    expect(r.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("falls back to GET when HEAD's status fails expectStatus", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const r = await checkApp({
      ...base,
      url: "https://x.example",
      checkType: "http",
      expectStatus: "200-299",
    });
    expect(r.up).toBe(true);
    expect(r.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][1]?.method).toBe("GET");
  });

  it("falls back to GET when HEAD throws (dropped connection)", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const r = await checkApp({ ...base, url: "https://x.example", checkType: "http" });
    expect(r.up).toBe(true);
    expect(r.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][1]?.method).toBe("GET");
  });

  it("reports the GET status when HEAD is 405", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const r = await checkApp({ ...base, url: "https://x.example", checkType: "http" });
    expect(r.up).toBe(true);
    expect(r.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("is down when both HEAD and the GET fallback fail", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ECONNRESET"));
    const r = await checkApp({ ...base, url: "https://x.example", checkType: "http" });
    expect(r.up).toBe(false);
    expect(r.status).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
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

  it.skipIf(!hasIPv6Loopback)("connects when the URL host is a bracketed IPv6 literal", async () => {
    // Regression test for #136: hostFromUrl must strip the brackets URL.hostname
    // leaves on IPv6 literals, or net.Socket#connect treats "[::1]" as a literal
    // (invalid) hostname and the connect fails even though the port is open.
    const server = net.createServer();
    await new Promise<void>((res, rej) => {
      server.once("error", rej);
      server.listen(0, "::1", res);
    });
    const port = (server.address() as net.AddressInfo).port;
    try {
      const r = await checkApp({
        ...base,
        url: "http://[::1]",
        checkType: "tcp",
        port,
      });
      expect(r.up).toBe(true);
    } finally {
      server.close();
    }
  });
});

describe("checkApp · dns", () => {
  it("is up when the server answers the probe query", async () => {
    const { setServers } = mockResolver(vi.fn().mockResolvedValue(["93.184.216.34"]));
    const r = await checkApp({ ...base, url: "http://1.2.3.4", checkType: "dns" });
    expect(r.up).toBe(true);
    // IP-literal host is used verbatim on port 53.
    expect(setServers).toHaveBeenCalledWith(["1.2.3.4"]);
  });

  it("does not resolve an IP-literal host", async () => {
    const lookup = vi.spyOn(dnsPromises, "lookup");
    mockResolver(vi.fn().mockResolvedValue(["93.184.216.34"]));
    const r = await checkApp({ ...base, url: "http://1.2.3.4", checkType: "dns" });
    expect(r.up).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("resolves a hostname server before querying it", async () => {
    vi.spyOn(dnsPromises, "lookup").mockResolvedValue({
      address: "10.0.0.53",
      family: 4,
    });
    const { setServers } = mockResolver(vi.fn().mockResolvedValue(["93.184.216.34"]));
    const r = await checkApp({ ...base, url: "http://pihole.lan", checkType: "dns" });
    expect(r.up).toBe(true);
    expect(setServers).toHaveBeenCalledWith(["10.0.0.53"]);
  });

  it("uses app.port for the resolver, ignoring the URL's port", async () => {
    const { setServers } = mockResolver(vi.fn().mockResolvedValue(["93.184.216.34"]));
    const r = await checkApp({
      ...base,
      url: "http://1.2.3.4:8080",
      checkType: "dns",
      port: 5335,
    });
    expect(r.up).toBe(true);
    expect(setServers).toHaveBeenCalledWith(["1.2.3.4:5335"]);
  });

  it("brackets an IPv6 server on a non-standard port", async () => {
    const { setServers } = mockResolver(vi.fn().mockResolvedValue(["93.184.216.34"]));
    const r = await checkApp({
      ...base,
      url: "http://[::1]",
      checkType: "dns",
      port: 5353,
    });
    expect(r.up).toBe(true);
    expect(setServers).toHaveBeenCalledWith(["[::1]:5353"]);
  });

  it("is up when the server responds NXDOMAIN (ENOTFOUND)", async () => {
    mockResolver(vi.fn().mockRejectedValue(dnsError("ENOTFOUND")));
    const r = await checkApp({ ...base, url: "http://1.2.3.4", checkType: "dns" });
    expect(r.up).toBe(true);
  });

  it("is up when the server refuses recursion (EREFUSED)", async () => {
    mockResolver(vi.fn().mockRejectedValue(dnsError("EREFUSED")));
    const r = await checkApp({ ...base, url: "http://1.2.3.4", checkType: "dns" });
    expect(r.up).toBe(true);
  });

  it("is down when the query times out (ETIMEOUT)", async () => {
    mockResolver(vi.fn().mockRejectedValue(dnsError("ETIMEOUT")));
    const r = await checkApp({ ...base, url: "http://1.2.3.4", checkType: "dns" });
    expect(r.up).toBe(false);
  });

  it("is down when the server hostname can't be resolved", async () => {
    vi.spyOn(dnsPromises, "lookup").mockRejectedValue(dnsError("ENOTFOUND"));
    const resolver = vi.spyOn(dnsPromises, "Resolver");
    const r = await checkApp({ ...base, url: "http://pihole.lan", checkType: "dns" });
    expect(r.up).toBe(false);
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe("checkApp · per-app timeout and retries (#292)", () => {
  it("retries a failed check and reports the first success", async () => {
    vi.useFakeTimers();
    try {
      // The first attempt fails outright (HEAD, then its GET fallback); the
      // retry's HEAD answers.
      const spy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValueOnce(new Error("blip"))
        .mockRejectedValueOnce(new Error("blip"))
        .mockResolvedValue(new Response("", { status: 200 }));
      const pending = checkApp({ ...base, url: "https://x.example", checkType: "http", retries: 2 });
      await vi.runAllTimersAsync();
      expect((await pending).up).toBe(true);
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops after its retries and reports the last failure", async () => {
    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
      const pending = checkApp({ ...base, url: "https://x.example", checkType: "http", retries: 2 });
      await vi.runAllTimersAsync();
      expect((await pending).up).toBe(false);
      // Each attempt is a HEAD plus its GET fallback; three attempts.
      expect(spy).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't retry without retries set", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    await checkApp({ ...base, url: "https://x.example", checkType: "http" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("gives up at the app's own timeout", async () => {
    // A server that accepts and never answers.
    const server = net.createServer(() => {});
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as net.AddressInfo;
    try {
      const started = Date.now();
      const r = await checkApp({
        ...base,
        url: `http://127.0.0.1:${port}/`,
        checkType: "http",
        timeout: 1,
      });
      expect(r.up).toBe(false);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      server.close();
    }
  });
});

describe("checkApp · json (#294)", () => {
  const json = (jsonQuery: string, expectStatus = "") => ({
    ...base,
    expectStatus,
    url: "https://api.example/health",
    checkType: "json" as const,
    jsonQuery,
  });

  it("is up when the query holds", async () => {
    mockFetch(200, JSON.stringify({ status: "ok", queue: 3 }));
    expect((await checkApp(json('$.status == "ok"'))).up).toBe(true);
  });

  it("is down when the query fails", async () => {
    mockFetch(200, JSON.stringify({ queue: 90 }));
    const r = await checkApp(json("$.queue < 50"));
    expect(r.up).toBe(false);
    expect(r.status).toBe(200);
  });

  it("is down when the body isn't JSON or the query doesn't parse", async () => {
    mockFetch(200, "<html>oops</html>");
    expect((await checkApp(json("$.status"))).up).toBe(false);
    mockFetch(200, "{}");
    expect((await checkApp(json("status"))).up).toBe(false);
  });

  it("honours expectStatus", async () => {
    mockFetch(503, JSON.stringify({ status: "ok" }));
    expect((await checkApp(json('$.status == "ok"', "200-299"))).up).toBe(false);
  });
});

describe("checkApp · push (#294)", () => {
  const push = (interval?: number) => ({
    ...base,
    id: "job",
    url: "https://job.test",
    checkType: "push" as const,
    interval,
  });

  it("is up while the last ping is within the interval plus a minute", async () => {
    const { recordPush, resetPushState } = await import("./push");
    resetPushState(0);
    recordPush("job", Date.now() - 5 * 60_000);
    expect((await checkApp(push(), { intervalMinutes: 5 })).up).toBe(true);
    recordPush("job", Date.now() - 7 * 60_000);
    expect((await checkApp(push(), { intervalMinutes: 5 })).up).toBe(false);
    // The app's own interval wins.
    expect((await checkApp(push(10), { intervalMinutes: 5 })).up).toBe(true);
  });

  it("gives a fresh process one grace window before the first ping", async () => {
    const { resetPushState } = await import("./push");
    resetPushState(Date.now());
    expect((await checkApp(push(), { intervalMinutes: 5 })).up).toBe(true);
  });
});
