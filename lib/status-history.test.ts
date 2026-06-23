import { describe, it, expect } from "vitest";
import { hourOf, uptimePct, dailyTimeline, type Bucket } from "./status-history";

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
    expect(tl.map((p) => p.date)).toEqual([
      "2026-06-21",
      "2026-06-22",
      "2026-06-23",
    ]);
    expect(tl[0].uptime).toBeNull();
    expect(tl[1].uptime).toBe(50);
    expect(tl[2].uptime).toBe(100);
  });
});
