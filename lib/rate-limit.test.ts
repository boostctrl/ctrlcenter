import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rateLimit, pruneRateLimit } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Clear any windows left over from a previous test by advancing past them.
    pruneRateLimit(Date.now() + 60 * 60 * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the limit, then blocks", () => {
    const key = `k-${Math.random()}`;
    expect(rateLimit(key, 3, 1000).allowed).toBe(true);
    expect(rateLimit(key, 3, 1000).allowed).toBe(true);
    const third = rateLimit(key, 3, 1000);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const blocked = rateLimit(key, 3, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("reports decreasing remaining count", () => {
    const key = `k-${Math.random()}`;
    expect(rateLimit(key, 5, 1000).remaining).toBe(4);
    expect(rateLimit(key, 5, 1000).remaining).toBe(3);
  });

  it("resets after the window elapses", () => {
    const key = `k-${Math.random()}`;
    rateLimit(key, 1, 1000);
    expect(rateLimit(key, 1, 1000).allowed).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(rateLimit(key, 1, 1000).allowed).toBe(true);
  });

  it("tracks distinct keys independently", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    rateLimit(a, 1, 1000);
    expect(rateLimit(a, 1, 1000).allowed).toBe(false);
    expect(rateLimit(b, 1, 1000).allowed).toBe(true);
  });

  it("prunes expired windows so a blocked key can pass again", () => {
    const key = `k-${Math.random()}`;
    rateLimit(key, 1, 1000);
    expect(rateLimit(key, 1, 1000).allowed).toBe(false);

    // Prune as if the window had elapsed; the key should be forgotten.
    pruneRateLimit(Date.now() + 2000);
    expect(rateLimit(key, 1, 1000).allowed).toBe(true);
  });
});
