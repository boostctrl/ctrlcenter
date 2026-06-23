import { describe, it, expect } from "vitest";
import {
  hourOf,
  uptimePct,
  dailyTimeline,
  hourlyTimeline,
  recentBars,
  recentPct,
  type Bucket,
  type Reading,
} from "./status-history";

const HOUR = 3_600_000;
const hr = (y: number, mo: number, d: number, h: number) =>
  Math.floor(Date.UTC(y, mo, d, h) / HOUR);

describe("hourOf", () => {
  it("floors a timestamp to its epoch hour number", () => {
    expect(hourOf(0)).toBe(0);
    expect(hourOf(HOUR)).toBe(1);
    expect(hourOf(HOUR * 5 + 1234)).toBe(5);
  });
});

describe("uptimePct", () => {
  const buckets: Bucket[] = [
    { hour: hr(2026, 5, 23, 1), up: 3, down: 1 },
    { hour: hr(2026, 5, 23, 2), up: 2, down: 0 },
  ];

  it("computes uptime over buckets at/after the cutoff", () => {
    expect(uptimePct(buckets, hr(2026, 5, 23, 1))).toBeCloseTo((5 / 6) * 100, 3);
    expect(uptimePct(buckets, hr(2026, 5, 23, 2))).toBe(100);
  });

  it("returns null with no samples in the window", () => {
    expect(uptimePct(buckets, hr(2026, 5, 24, 0))).toBeNull();
    expect(uptimePct([], hr(2026, 5, 23, 0))).toBeNull();
  });
});

describe("dailyTimeline", () => {
  it("returns one point per UTC day (oldest→newest) ending today", () => {
    const nowHour = hr(2026, 5, 23, 12);
    const buckets: Bucket[] = [
      { hour: hr(2026, 5, 22, 5), up: 2, down: 2 },
      { hour: hr(2026, 5, 23, 1), up: 3, down: 0 },
    ];
    const tl = dailyTimeline(buckets, 3, nowHour);
    expect(tl.map((p) => p.at)).toEqual([
      "2026-06-21",
      "2026-06-22",
      "2026-06-23",
    ]);
    expect(tl[0].uptime).toBeNull();
    expect(tl[1].uptime).toBe(50);
    expect(tl[2].uptime).toBe(100);
  });
});

describe("recentBars / recentPct", () => {
  const now = Date.UTC(2026, 5, 23, 12, 30);
  const readings: Reading[] = [
    { t: now - 90 * 60_000, up: true }, // outside the window
    { t: now - 40 * 60_000, up: false },
    { t: now - 10 * 60_000, up: true },
    { t: now - 5 * 60_000, up: true },
  ];
  const since = now - 60 * 60_000;

  it("recentBars keeps the window, oldest→newest, binary uptime", () => {
    const bars = recentBars(readings, since);
    expect(bars.map((b) => b.uptime)).toEqual([0, 100, 100]);
    expect(bars[0].at).toBe("2026-06-23T11:50");
  });

  it("recentPct is the up-share in the window, or null when empty", () => {
    expect(recentPct(readings, since)).toBeCloseTo((2 / 3) * 100, 3);
    expect(recentPct(readings, now + 60_000)).toBeNull();
    expect(recentPct([], since)).toBeNull();
  });
});

describe("hourlyTimeline", () => {
  it("returns the last N hours (oldest→newest) with null gaps", () => {
    const nowHour = hr(2026, 5, 23, 12);
    const buckets: Bucket[] = [
      { hour: nowHour, up: 5, down: 0 },
      { hour: nowHour - 2, up: 1, down: 1 },
    ];
    const tl = hourlyTimeline(buckets, 3, nowHour);
    expect(tl.length).toBe(3);
    expect(tl[0].uptime).toBe(50); // nowHour-2
    expect(tl[1].uptime).toBeNull(); // nowHour-1
    expect(tl[2].uptime).toBe(100); // nowHour
    expect(tl[2].at).toBe("2026-06-23T12");
  });
});
