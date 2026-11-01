import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  arrivedForwarded,
  peekRateLimit,
  rateLimit,
  refundRateLimit,
  pruneRateLimit,
  throttleBucket,
} from "./rate-limit";

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

  it("refunds one charge, so successes never accumulate into a lockout (#277)", () => {
    const key = `k-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      expect(rateLimit(key, 3, 1000).allowed).toBe(true);
      refundRateLimit(key);
    }
    // Refunds give back one charge each, not a reset: failures still count.
    rateLimit(key, 3, 1000);
    rateLimit(key, 3, 1000);
    rateLimit(key, 3, 1000);
    refundRateLimit(key);
    expect(rateLimit(key, 3, 1000).allowed).toBe(true);
    expect(rateLimit(key, 3, 1000).allowed).toBe(false);
  });

  it("ignores a refund for an unknown or expired window", () => {
    const key = `k-${Math.random()}`;
    refundRateLimit(key);
    rateLimit(key, 1, 1000);
    vi.advanceTimersByTime(1500);
    refundRateLimit(key);
    expect(rateLimit(key, 1, 1000).allowed).toBe(true);
    expect(rateLimit(key, 1, 1000).allowed).toBe(false);
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

  it("lengthens each lockout of an escalating key, and forgets them on a refund (#369)", () => {
    const key = `k-${Math.random()}`;
    const fill = () => {
      for (let i = 0; i < 3; i++) rateLimit(key, 3, 1000, { escalate: true });
      return rateLimit(key, 3, 1000, { escalate: true });
    };
    // First lockout: the plain window. Second: twice as long. Third: four times.
    expect(fill().retryAfterSeconds).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(fill().retryAfterSeconds).toBe(2);
    vi.advanceTimersByTime(2000);
    expect(fill().retryAfterSeconds).toBe(4);
    vi.advanceTimersByTime(4000);
    // A refund (the real admin signed in) resets the escalation.
    refundRateLimit(key);
    expect(fill().retryAfterSeconds).toBe(1);
  });

  it("caps an escalating lockout at an hour", () => {
    const key = `k-${Math.random()}`;
    const windowMs = 20 * 60 * 1000;
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 2; i++) rateLimit(key, 2, windowMs, { escalate: true });
      const blocked = rateLimit(key, 2, windowMs, { escalate: true });
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(3600);
      vi.advanceTimersByTime(blocked.retryAfterSeconds * 1000);
    }
  });

  it("never escalates a key that doesn't ask for it", () => {
    const key = `k-${Math.random()}`;
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 3; i++) rateLimit(key, 3, 1000);
      expect(rateLimit(key, 3, 1000).retryAfterSeconds).toBe(1);
      vi.advanceTimersByTime(1000);
    }
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

describe("arrivedForwarded (#383)", () => {
  const forwarded = (entry: boolean, headers: Record<string, string>) => {
    vi.stubEnv("CTRLCENTER_PEER_HEADER", entry ? "1" : "");
    return arrivedForwarded(new NextRequest("http://dash.lan/api/login", { headers }));
  };
  afterEach(() => vi.unstubAllEnvs());

  it("takes the production entry's stamp, not the X-Forwarded-For Next fills in", () => {
    expect(forwarded(true, { "x-ctrlcenter-forwarded": "1", "x-forwarded-for": "1.2.3.4" })).toBe(true);
    // Next set X-Forwarded-For from the socket; the entry saw none.
    expect(forwarded(true, { "x-ctrlcenter-forwarded": "0", "x-forwarded-for": "203.0.113.9" })).toBe(false);
    expect(forwarded(true, { "x-forwarded-for": "203.0.113.9" })).toBeNull();
    expect(forwarded(true, { "x-ctrlcenter-forwarded": "yes" })).toBeNull();
  });

  it("is unknown without the entry, ignoring a client-sent stamp", () => {
    expect(forwarded(false, { "x-ctrlcenter-forwarded": "1", "x-forwarded-for": "1.2.3.4" })).toBeNull();
    expect(forwarded(false, { "x-ctrlcenter-forwarded": "0" })).toBeNull();
    expect(forwarded(false, {})).toBeNull();
  });
});

describe("throttleBucket (#392)", () => {
  it("keeps an IPv4 address, and an IPv4-mapped IPv6 address, as the IPv4 address", () => {
    expect(throttleBucket("203.0.113.9")).toBe("203.0.113.9");
    expect(throttleBucket("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("buckets an IPv6 address by its /64, whatever its spelling", () => {
    expect(throttleBucket("2001:db8:1:2:3:4:5:6")).toBe("2001:0db8:0001:0002::/64");
    expect(throttleBucket("2001:DB8:1:2::1")).toBe("2001:0db8:0001:0002::/64");
    expect(throttleBucket("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe("2001:0db8:0001:0002::/64");
    expect(throttleBucket("fe80::1%eth0")).toBe("fe80:0000:0000:0000::/64");
    expect(throttleBucket("::1")).toBe("0000:0000:0000:0000::/64");
    expect(throttleBucket("64:ff9b::192.0.2.33")).toBe("0064:ff9b:0000:0000::/64");
    // Two addresses in one allotment share a bucket; the next /64 is another.
    expect(throttleBucket("2001:db8:1:2::1")).toBe(throttleBucket("2001:db8:1:2:dead:beef::1"));
    expect(throttleBucket("2001:db8:1:3::1")).not.toBe(throttleBucket("2001:db8:1:2::1"));
  });

  it("returns text that isn't an address unchanged", () => {
    expect(throttleBucket("1:2:3")).toBe("1:2:3");
    expect(throttleBucket("2001:db8::1::2")).toBe("2001:db8::1::2");
    expect(throttleBucket("gggg::1")).toBe("gggg::1");
    expect(throttleBucket("::ffff:300.1.1.1")).toBe("::ffff:300.1.1.1");
  });
});

describe("peekRateLimit and strike-keeping refunds (#392)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pruneRateLimit(Date.now() + 60 * 60 * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a key's state without charging it", () => {
    const key = `k-${Math.random()}`;
    expect(peekRateLimit(key, 2)).toMatchObject({ allowed: true, remaining: 2 });
    rateLimit(key, 2, 1000);
    expect(peekRateLimit(key, 2)).toMatchObject({ allowed: true, remaining: 1 });
    expect(peekRateLimit(key, 2)).toMatchObject({ allowed: true, remaining: 1 });
    rateLimit(key, 2, 1000);
    const full = peekRateLimit(key, 2);
    expect(full.allowed).toBe(false);
    expect(full.retryAfterSeconds).toBeGreaterThan(0);
    vi.advanceTimersByTime(1500);
    expect(peekRateLimit(key, 2).allowed).toBe(true);
  });

  it("keeps the escalation history on a keepStrikes refund, and clears it on a plain one", () => {
    const retryAfterSecondTrip = (opts?: { keepStrikes: boolean }) => {
      const key = `k-${Math.random()}`;
      // First trip: the lockout lasts the window.
      rateLimit(key, 2, 1000, { escalate: true });
      rateLimit(key, 2, 1000, { escalate: true });
      vi.advanceTimersByTime(1500);
      // A charge given back the way the two-step form's first step is...
      rateLimit(key, 2, 1000, { escalate: true });
      refundRateLimit(key, opts);
      // ...then the second trip.
      rateLimit(key, 2, 1000, { escalate: true });
      rateLimit(key, 2, 1000, { escalate: true });
      return rateLimit(key, 2, 1000, { escalate: true }).retryAfterSeconds;
    };
    expect(retryAfterSecondTrip({ keepStrikes: true })).toBe(2);
    expect(retryAfterSecondTrip()).toBe(1);
  });
});
