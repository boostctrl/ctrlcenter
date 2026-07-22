import { afterEach, describe, expect, it, vi } from "vitest";
import { serviceRequest, serviceBase, ServiceError } from "./http";

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
