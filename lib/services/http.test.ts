import { afterEach, describe, expect, it, vi } from "vitest";
import { serviceRequest, serviceBase, ServiceError, throwForStatus } from "./http";

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
