import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { swrCache, type SwrLoader } from "./swr-cache";

// The shared stale-while-revalidate cache (#286). Each test gets its own
// cache name, since state lives on globalThis.
let n = 0;
const fresh = <V,>(ttl = 1000) => swrCache<V>(`test-${++n}`, ttl);

// A loader whose calls resolve only when the test says so.
function deferredLoader<V>() {
  const pending: ((v: V | undefined) => void)[] = [];
  const load = vi.fn<SwrLoader<V>>(
    () => new Promise<V | undefined>((resolve) => pending.push(resolve))
  );
  return { load, resolveNext: (v: V | undefined) => pending.shift()!(v), pending };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("swrCache", () => {
  it("blocks on a cold key, then serves the cached value within the TTL", async () => {
    const cache = fresh<string>();
    const load = vi.fn(async () => "v1");
    expect(await cache.get("k", load)).toBe("v1");
    vi.advanceTimersByTime(999);
    expect(await cache.get("k", load)).toBe("v1");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("serves a stale value immediately and refreshes once in the background", async () => {
    const cache = fresh<string>();
    await cache.get("k", async () => "old");
    vi.advanceTimersByTime(1000);
    const { load, resolveNext } = deferredLoader<string>();
    // Three readers while the refresh is pending: all get "old", one fetch.
    expect(await cache.get("k", load)).toBe("old");
    expect(await cache.get("k", load)).toBe("old");
    expect(await cache.get("k", load)).toBe("old");
    expect(load).toHaveBeenCalledTimes(1);
    resolveNext("new");
    await vi.runAllTimersAsync();
    expect(await cache.get("k", load)).toBe("new");
  });

  it("shares one load between concurrent cold readers", async () => {
    const cache = fresh<number>();
    const { load, resolveNext } = deferredLoader<number>();
    const reads = [cache.get("k", load), cache.get("k", load)];
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    resolveNext(42);
    expect(await Promise.all(reads)).toEqual([42, 42]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps the old entry when the loader returns undefined, and retries next time", async () => {
    const cache = fresh<string>();
    await cache.get("k", async () => "good");
    vi.advanceTimersByTime(1000);
    const failing = vi.fn(async () => undefined);
    await cache.get("k", failing);
    await vi.runAllTimersAsync();
    expect(cache.peek("k")?.value).toBe("good");
    // Not re-armed: the very next read tries again.
    await cache.get("k", failing);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("hands the loader the previous entry (conditional revalidation)", async () => {
    const cache = fresh<string>();
    await cache.get("k", async () => "body");
    vi.advanceTimersByTime(1000);
    const load = vi.fn<SwrLoader<string>>(async (prev) => prev?.value);
    await cache.get("k", load);
    await vi.runAllTimersAsync();
    expect(load.mock.calls[0][0]?.value).toBe("body");
    // Returning prev.value re-arms the TTL.
    expect(cache.peek("k")?.at).toBe(Date.now());
  });

  it("returns undefined for a key that has never loaded", async () => {
    const cache = fresh<string>();
    expect(await cache.get("k", async () => undefined)).toBeUndefined();
  });

  it("fences off a refresh that was running when its key was deleted", async () => {
    const cache = fresh<string>();
    const slow = deferredLoader<string>();
    const first = cache.get("k", slow.load);
    cache.delete("k");
    // The next read starts its own fetch instead of joining the doomed one.
    const second = cache.get("k", async () => "after-delete");
    expect(await second).toBe("after-delete");
    slow.resolveNext("stale");
    await first;
    expect(cache.peek("k")?.value).toBe("after-delete");
  });

  it("deleteWhere drops every matching key", async () => {
    const cache = fresh<string>();
    await cache.get("svc|a", async () => "a");
    await cache.get("svc|b", async () => "b");
    await cache.get("other", async () => "o");
    cache.deleteWhere((k) => k.startsWith("svc|"));
    expect(cache.peek("svc|a")).toBeUndefined();
    expect(cache.peek("svc|b")).toBeUndefined();
    expect(cache.peek("other")?.value).toBe("o");
  });

  it("survives a loader that throws synchronously", async () => {
    const cache = fresh<string>();
    const load = vi.fn<SwrLoader<string>>(() => {
      throw new Error("sync boom");
    });
    expect(await cache.get("k", load)).toBeUndefined();
    // The in-flight slot was released, so the next read tries again.
    expect(await cache.get("k", async () => "ok")).toBe("ok");
  });

  it("survives a loader that throws, keeping the old entry", async () => {
    const cache = fresh<string>();
    await cache.get("k", async () => "kept");
    vi.advanceTimersByTime(1000);
    await cache.get("k", async () => {
      throw new Error("bug");
    });
    await vi.runAllTimersAsync();
    expect(cache.peek("k")?.value).toBe("kept");
  });
});
