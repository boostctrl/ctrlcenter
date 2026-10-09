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

describe("clientIp", () => {
  // TRUSTED_PROXY_HOPS is read at module load, so each case imports fresh.
  async function ipFor(
    env: { hops?: string; entry?: boolean },
    headers: Record<string, string>
  ): Promise<string | null> {
    vi.resetModules();
    vi.stubEnv("TRUSTED_PROXY_HOPS", env.hops ?? "1");
    vi.stubEnv("CTRLCENTER_PEER_HEADER", env.entry ? "1" : "");
    const { clientIp } = await import("./rate-limit");
    const { NextRequest } = await import("next/server");
    return clientIp(new NextRequest("http://dash.lan/api/login", { headers }));
  }
  afterEach(() => vi.unstubAllEnvs());

  describe("with the production entry (socket peer known)", () => {
    it("uses the peer itself when exposed directly (hops=0), ignoring a forged header", async () => {
      expect(
        await ipFor({ hops: "0", entry: true }, {
          "x-forwarded-for": "1.2.3.4",
          "x-ctrlcenter-peer": "203.0.113.9",
        })
      ).toBe("203.0.113.9");
    });

    it("takes what the one trusted proxy saw (hops=1), whatever the client prepended", async () => {
      expect(
        await ipFor({ hops: "1", entry: true }, {
          "x-forwarded-for": "6.6.6.6, 198.51.100.7",
          "x-ctrlcenter-peer": "10.0.0.2",
        })
      ).toBe("198.51.100.7");
    });

    it("is null when there are fewer hops than configured", async () => {
      expect(
        await ipFor({ hops: "2", entry: true }, { "x-ctrlcenter-peer": "10.0.0.2" })
      ).toBeNull();
    });
  });

  describe("without the entry (next start)", () => {
    it("ignores a client-sent peer header", async () => {
      expect(
        await ipFor({ hops: "0" }, { "x-ctrlcenter-peer": "203.0.113.9" })
      ).toBeNull();
    });

    it("keeps the previous behavior: the last X-Forwarded-For entry at hops=1", async () => {
      expect(
        await ipFor({ hops: "1" }, { "x-forwarded-for": "6.6.6.6, 198.51.100.7" })
      ).toBe("198.51.100.7");
      expect(await ipFor({ hops: "0" }, { "x-forwarded-for": "198.51.100.7" })).toBeNull();
    });
  });
});
