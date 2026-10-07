import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchWithTimeout, timeoutSignal } from "./fetch-body";
import { errorReason } from "./log";

// A local server that sends headers and one chunk, then never finishes — so a
// timeout has to abort either the request or the body read.
let server: http.Server | null = null;
afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((r) => server!.close(r));
  server = null;
});
async function hangingServer(sendHeaders: boolean): Promise<string> {
  server = http.createServer((_req, res) => {
    if (!sendHeaders) return;
    res.writeHead(200);
    res.write("partial");
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

describe("timeoutSignal", () => {
  it("aborts with an AbortError (not a TimeoutError) after the delay", async () => {
    const signal = timeoutSignal(10);
    expect(signal.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).name).toBe("AbortError");
  });
});

describe("fetchWithTimeout", () => {
  it("rejects a request with no response as an AbortError", async () => {
    const url = await hangingServer(false);
    const err = await fetchWithTimeout(url, {}, 50).catch((e) => e);
    expect(err.name).toBe("AbortError");
    // errorReason's "timeout" log reason keys on the AbortError name.
    expect(errorReason(err)).toBe("timeout");
  });

  it("keeps the budget running through the body read", async () => {
    const url = await hangingServer(true);
    const res = await fetchWithTimeout(url, {}, 50);
    expect(res.status).toBe(200);
    const err = await res.text().catch((e) => e);
    expect(err.name).toBe("AbortError");
  });

  it("honours a caller-supplied signal alongside the timeout", async () => {
    const url = await hangingServer(false);
    const controller = new AbortController();
    const pending = fetchWithTimeout(url, { signal: controller.signal }, 5000);
    controller.abort();
    const err = await pending.catch((e) => e);
    expect(err.name).toBe("AbortError");
  });
});
