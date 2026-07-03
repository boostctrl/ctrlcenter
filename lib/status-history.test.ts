import { describe, it, expect } from "vitest";
import {
  hourOf,
  uptimePct,
  recentPct,
  fixedBarsFromReadings,
  fixedBarsFromBuckets,
  type Bucket,
  type Reading,
} from "./status-history";

const HOUR = 3_600_000;
const MIN = 60_000;
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

describe("recentPct", () => {
  const now = Date.UTC(2026, 5, 23, 12, 30);
  const readings: Reading[] = [
    { t: now - 90 * MIN, up: true }, // outside the 60-minute window
    { t: now - 40 * MIN, up: false },
    { t: now - 10 * MIN, up: true },
    { t: now - 5 * MIN, up: true },
  ];
  const since = now - 60 * MIN;

  it("is the up-share in the window, or null when empty", () => {
    expect(recentPct(readings, since)).toBeCloseTo((2 / 3) * 100, 3);
    expect(recentPct(readings, now + MIN)).toBeNull();
    expect(recentPct([], since)).toBeNull();
  });
});

describe("fixedBarsFromReadings", () => {
  it("resamples readings into a fixed count of equal buckets, null where empty", () => {
    const readings: Reading[] = [
      { t: -10, up: true }, // before the window — ignored
      { t: 30 * 1000, up: true }, // bucket 0
      { t: 90 * 1000, up: false }, // bucket 1
      { t: 90 * 1000 + 500, up: true }, // bucket 1
      { t: 210 * 1000, up: true }, // bucket 3 (bucket 2 stays empty)
    ];
    const bars = fixedBarsFromReadings(readings, 0, 4 * MIN, 4);
    expect(bars).toHaveLength(4);
    expect(bars.map((b) => b.uptime)).toEqual([100, 50, null, 100]);
    expect(bars[0].at).toBe("1970-01-01T00:00");
  });

  it("clamps a reading at the window end into the last bucket", () => {
    const bars = fixedBarsFromReadings([{ t: 2 * MIN, up: false }], 0, 2 * MIN, 2);
    expect(bars.map((b) => b.uptime)).toEqual([null, 0]);
  });
});

describe("fixedBarsFromBuckets", () => {
  const at = (ms: number) => String(ms);

  it("down-samples several hours into fewer buckets (summing), null where none", () => {
    const buckets: Bucket[] = [
      { hour: 0, up: 3, down: 1 },
      { hour: 1, up: 2, down: 0 },
      { hour: 3, up: 0, down: 4 },
    ];
    const out = fixedBarsFromBuckets(buckets, 0, 4 * HOUR, 2, at);
    expect(out).toHaveLength(2);
    expect(out[0].uptime).toBeCloseTo((5 / 6) * 100, 6); // hours 0+1
    expect(out[1].uptime).toBe(0); // hour 3 only
    expect(out.map((b) => b.at)).toEqual(["0", String(2 * HOUR)]);
  });

  it("up-samples one hour across sub-hour buckets, keeping its ratio (no gaps)", () => {
    const out = fixedBarsFromBuckets([{ hour: 0, up: 3, down: 1 }], 0, HOUR, 3, at);
    expect(out).toHaveLength(3);
    for (const b of out) expect(b.uptime).toBeCloseTo(75, 6);
  });

  it("is null for a bucket whose hours have no data", () => {
    const out = fixedBarsFromBuckets([{ hour: 0, up: 1, down: 0 }], 0, 2 * HOUR, 2, at);
    expect(out[0].uptime).toBe(100);
    expect(out[1].uptime).toBeNull();
  });
});
