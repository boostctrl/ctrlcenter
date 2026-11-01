import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  serviceRequest,
  serviceBase,
  ServiceError,
  throwForStatus,
  insecureHttpsRequest,
  SERVICE_MAX_BYTES,
} from "./http";

// insecureHttpsRequest (#402) is exercised against a plain local server:
// node:https is swapped for node:http in this file, so the request and
// response objects — and the deadline and close handling under test — are the
// real ones, without a self-signed certificate to mint. Nothing else here
// touches https.
vi.mock("node:https", async () => {
  const http = await import("node:http");
  return { default: { request: http.request } };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("serviceRequest body reading", () => {
  it("reads the real body even when Content-Length claims a huge size", async () => {
    // A service (or a middlebox in front of it) sends a small body with a
    // Content-Length header far larger than the cap. The old header-trusting
    // read failed this as "Response too large"; now the actual body is read.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("Ok.", {
            headers: { "content-length": String(50 * 1024 * 1024) },
          })
      )
    );
    const { text } = await serviceRequest("http://svc.local/x");
    expect(text).toBe("Ok.");
  });

  it("still rejects a body that is genuinely over the cap", async () => {
    const big = "x".repeat(200 * 1024);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(big)));
    await expect(
      serviceRequest("http://svc.local/x", {}, 100 * 1024)
    ).rejects.toThrow(/too large/i);
  });

  it("returns empty text for a bodiless response instead of erroring", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 }))
    );
    const { text } = await serviceRequest("http://svc.local/x");
    expect(text).toBe("");
  });
});

describe("serviceBase", () => {
  it("trims trailing slashes and requires http(s)", () => {
    expect(serviceBase("http://x.local:8080/")).toBe("http://x.local:8080");
    expect(serviceBase("https://x.local///")).toBe("https://x.local");
    expect(() => serviceBase("x.local:8080")).toThrow(ServiceError);
  });

  it("refuses an address that only looks like a URL, before a fetch could quote it whole (#402)", () => {
    // fetch's own error for this one is "Failed to parse URL from <the whole
    // URL>", apikey and all, straight into the log.
    expect(() => serviceBase("http://192.168.1.300:8181")).toThrow("Set a valid http(s) URL");
    expect(() => serviceBase("http://")).toThrow(ServiceError);
    expect(() => serviceBase("ftp://x.local")).toThrow(ServiceError);
  });
});

describe("throwForStatus", () => {
  const res = (status: number) => new Response(null, { status });
  const KEY = { 401: "Invalid API key", 403: "Invalid API key" };

  it("passes a 2xx", () => {
    expect(() => throwForStatus(res(200))).not.toThrow();
    expect(() => throwForStatus(res(204), KEY)).not.toThrow();
  });

  it("maps a listed status to its message, as a ServiceError", () => {
    expect(() => throwForStatus(res(401), KEY)).toThrow(ServiceError);
    expect(() => throwForStatus(res(401), KEY)).toThrow("Invalid API key");
    expect(() => throwForStatus(res(403), KEY)).toThrow("Invalid API key");
  });

  it("reports any other failure as HTTP <status>", () => {
    expect(() => throwForStatus(res(500), KEY)).toThrow(ServiceError);
    expect(() => throwForStatus(res(500), KEY)).toThrow("HTTP 500");
    // Without a mapping an auth status is just another HTTP failure.
    expect(() => throwForStatus(res(401))).toThrow("HTTP 401");
  });

  it("accepts a plain { status, ok } (insecureHttpsRequest's shape)", () => {
    const login = { 400: "Login failed", 404: "Not a controller" };
    expect(() => throwForStatus({ status: 400, ok: false }, login)).toThrow(
      "Login failed"
    );
    expect(() => throwForStatus({ status: 404, ok: false }, login)).toThrow(
      "Not a controller"
    );
    expect(() => throwForStatus({ status: 200, ok: true }, login)).not.toThrow();
  });
});

// Redirects (#389): a service request follows one only on the same host. fetch's
// own following kept custom headers (X-Api-Key, an API widget's) and replayed
// a 307/308 body (a login) on a hop to another host.
describe("serviceRequest redirects", () => {
  type Call = { url: string; init: RequestInit };
  // A fake network: each URL answers from the table; every request is logged.
  function network(routes: Record<string, () => Response>) {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const route = routes[url];
        return route ? route() : new Response("missing", { status: 404 });
      })
    );
    return calls;
  }
  const redirect = (status: number, location: string) => () =>
    new Response(null, { status, headers: { location } });

  it("refuses a redirect to another host, so the key and body stay put", async () => {
    const calls = network({
      "http://sonarr.lan:8989/api/v3/system/status": redirect(307, "https://auth.example.com/login"),
    });
    await expect(
      serviceRequest("http://sonarr.lan:8989/api/v3/system/status", {
        method: "POST",
        headers: { "X-Api-Key": "SECRET" },
        body: "username=u&password=p",
      })
    ).rejects.toThrow("Redirected to another host — check the URL");
    expect(calls.map((c) => c.url)).toEqual(["http://sonarr.lan:8989/api/v3/system/status"]);
    expect(calls[0].init.redirect).toBe("manual");
  });

  it("refuses a downgrade to plain http, even on the same host", async () => {
    const calls = network({ "https://nas.lan/api": redirect(301, "http://nas.lan/api") });
    await expect(serviceRequest("https://nas.lan/api")).rejects.toThrow(/another host/);
    expect(calls).toHaveLength(1);
  });

  it("follows a same-host redirect with the headers and body intact", async () => {
    const calls = network({
      "http://qb.lan:8080/api/v2/auth/login": redirect(308, "/api/v2/auth/login/"),
      "http://qb.lan:8080/api/v2/auth/login/": () => new Response("Ok."),
    });
    const { text } = await serviceRequest("http://qb.lan:8080/api/v2/auth/login", {
      method: "POST",
      headers: { "X-Api-Key": "SECRET" },
      body: "username=u&password=p",
    });
    expect(text).toBe("Ok.");
    expect(calls[1].init).toMatchObject({ method: "POST", body: "username=u&password=p", headers: { "X-Api-Key": "SECRET" } });
  });

  it("follows an upgrade to https on the same host, on another port", async () => {
    const calls = network({
      "http://nas.lan/api": redirect(301, "https://nas.lan:8443/api"),
      "https://nas.lan:8443/api": () => new Response("{}"),
    });
    await serviceRequest("http://nas.lan/api");
    expect(calls.map((c) => c.url)).toEqual(["http://nas.lan/api", "https://nas.lan:8443/api"]);
  });

  it("turns a 303, or a 301/302 after a POST, into a body-less GET", async () => {
    const calls = network({
      "http://svc.lan/a": redirect(302, "/b"),
      "http://svc.lan/b": redirect(303, "/c"),
      "http://svc.lan/c": () => new Response("done"),
    });
    await serviceRequest("http://svc.lan/a", { method: "POST", body: "x=1" });
    expect(calls.map((c) => [c.url, c.init.method, c.init.body])).toEqual([
      ["http://svc.lan/a", "POST", "x=1"],
      ["http://svc.lan/b", "GET", undefined],
      ["http://svc.lan/c", "GET", undefined],
    ]);
  });

  it("stops a redirect loop", async () => {
    network({
      "http://svc.lan/a": redirect(302, "/b"),
      "http://svc.lan/b": redirect(302, "/a"),
    });
    await expect(serviceRequest("http://svc.lan/a")).rejects.toThrow("Too many redirects");
  });

  it("hands back a 3xx without a Location, for the caller's status mapping", async () => {
    network({ "http://svc.lan/a": () => new Response(null, { status: 304 }) });
    const { res } = await serviceRequest("http://svc.lan/a");
    expect(res.status).toBe(304);
  });

  it("keeps an X-Api-Key from a real server on another host (cross-origin 307)", async () => {
    // Two real servers: A answers 307 to B, which records what it receives.
    // 127.0.0.1 and localhost are different hosts to the URL rules.
    const seen: string[] = [];
    const b = http.createServer((req, res) => {
      seen.push(String(req.headers["x-api-key"]));
      res.end("{}");
    });
    await new Promise<void>((r) => b.listen(0, "127.0.0.1", r));
    const bPort = (b.address() as AddressInfo).port;
    const a = http.createServer((_req, res) => {
      res.writeHead(307, { location: `http://localhost:${bPort}/` }).end();
    });
    await new Promise<void>((r) => a.listen(0, "127.0.0.1", r));
    const aPort = (a.address() as AddressInfo).port;
    try {
      await expect(
        serviceRequest(`http://127.0.0.1:${aPort}/api`, { headers: { "X-Api-Key": "SECRET" } })
      ).rejects.toThrow(/another host/);
      expect(seen).toEqual([]);
    } finally {
      a.close();
      b.close();
    }
  });
});

// The self-signed path (#402): one deadline for the whole exchange, and a
// connection that drops mid-body fails instead of pending for good.
describe("insecureHttpsRequest", () => {
  let server: http.Server | null = null;
  afterEach(async () => {
    if (!server) return;
    server.closeAllConnections();
    await new Promise((r) => server!.close(r));
    server = null;
  });
  async function serve(handler: http.RequestListener): Promise<string> {
    server = http.createServer(handler);
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  }

  it("settles a complete response with its status, cookies and text", async () => {
    let got: { method?: string; key?: string; body: string } = { body: "" };
    const url = await serve((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        got = { method: req.method, key: String(req.headers["x-api-key"]), body };
        res.setHeader("set-cookie", ["TOKEN=jwt; Path=/; HttpOnly", "csrf=1"]);
        res.end("hello");
      });
    });
    const out = await insecureHttpsRequest(url, {
      method: "POST",
      headers: { "X-Api-Key": "SECRET" },
      body: "u=1",
    });
    expect(out).toEqual({
      status: 200,
      ok: true,
      setCookie: ["TOKEN=jwt; Path=/; HttpOnly", "csrf=1"],
      text: "hello",
    });
    expect(got).toEqual({ method: "POST", key: "SECRET", body: "u=1" });
  });

  it("gives up on a body that dribbles past the deadline", async () => {
    // A byte every 10 ms never trips a socket idle timeout; the overall
    // deadline has to end it.
    const url = await serve((_req, res) => {
      res.writeHead(200);
      const drip = setInterval(() => res.write("x"), 10);
      res.on("close", () => clearInterval(drip));
    });
    const started = Date.now();
    await expect(insecureHttpsRequest(url, {}, SERVICE_MAX_BYTES, 100)).rejects.toThrow("Timed out");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("fails, rather than hanging, when the connection drops mid-body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const url = await serve((_req, res) => {
      res.writeHead(200, { "content-length": "100" });
      res.write("partial");
      setTimeout(() => res.destroy(), 10);
    });
    await expect(insecureHttpsRequest(url, {}, SERVICE_MAX_BYTES, 2000)).rejects.toThrow(
      "Couldn't connect"
    );
  });
});
