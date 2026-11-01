import { describe, it, expect, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchWithTimeout, readCappedBytes, streamCapped, timeoutSignal } from "./fetch-body";
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

describe("streamCapped", () => {
  // A body of `pieces`, one per read, counting how many were pulled.
  function body(pieces: Uint8Array[]) {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const piece = pieces[pulled++];
        if (piece === undefined) controller.close();
        else controller.enqueue(piece);
      },
    });
    return { res: new Response(stream), pulled: () => pulled };
  }

  it("hands every chunk to the sink in order and reports a complete body", async () => {
    const { res } = body([new Uint8Array([1, 2]), new Uint8Array([3])]);
    const seen: number[] = [];
    expect(await streamCapped(res, 10, (c) => seen.push(...c))).toBe(true);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("stops at the cap, pulls no more, and reports an incomplete body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { res, pulled } = body(Array.from({ length: 6 }, () => new Uint8Array(4)));
    let sunk = 0;
    expect(await streamCapped(res, 10, (c) => (sunk += c.length))).toBe(false);
    // The third chunk tips it (12 > 10) and is not handed on.
    expect(sunk).toBe(8);
    expect(pulled()).toBeLessThanOrEqual(4);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("treats a body-less response as empty, not too large", async () => {
    expect(await streamCapped(new Response(null), 10, () => undefined)).toBe(true);
    expect(await readCappedBytes(new Response(null), 10)).toEqual(Buffer.alloc(0));
  });
});
