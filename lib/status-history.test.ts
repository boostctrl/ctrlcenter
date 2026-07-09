import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  hourOf,
  uptimePct,
  recentPct,
  latencyOverBuckets,
  recentLatency,
  oldestSampleMs,
  fixedBarsFromReadings,
  fixedBarsFromBuckets,
  loadHistory,
  flush,
  recordResults,
  getHistory,
  type Bucket,
  type Reading,
} from "./status-history";

const HOUR = 3_600_000;
const MIN = 60_000;
const hr = (y: number, mo: number, d: number, h: number) =>
  Math.floor(Date.UTC(y, mo, d, h) / HOUR);

// Bucket factory. The latency accumulators (msCount/msSum/msMax) were added
// after the up/down tally, so a test that only cares about uptime can leave them
// at zero; the latency tests pass the third arg.
const bkt = (
  hour: number,
  up: number,
  down: number,
  ms: { count?: number; sum?: number; max?: number } = {}
): Bucket => ({
  hour,
  up,
  down,
  msCount: ms.count ?? 0,
  msSum: ms.sum ?? 0,
  msMax: ms.max ?? 0,
});

// The store lives on globalThis (so the poller and the reader share one
// instance). The persistence tests below reach in to force a fresh load — the
// module's `state` object IS this object, so mutating its fields resets the
// module's view. The pure-helper tests above never touch it.
const g = globalThis as unknown as {
  __ctrlcenterStatusHistory?: {
    loaded: boolean;
    store: Map<string, unknown>;
    recent: Map<string, unknown>;
    downSince: Map<string, unknown>;
  };
};
function resetHistoryState() {
  const s = g.__ctrlcenterStatusHistory;
  if (s) {
    s.loaded = false;
    s.store = new Map();
    s.recent = new Map();
    s.downSince = new Map();
  }
}

describe("hourOf", () => {
  it("floors a timestamp to its epoch hour number", () => {
    expect(hourOf(0)).toBe(0);
    expect(hourOf(HOUR)).toBe(1);
    expect(hourOf(HOUR * 5 + 1234)).toBe(5);
  });
});

describe("uptimePct", () => {
  const buckets: Bucket[] = [
    bkt(hr(2026, 5, 23, 1), 3, 1),
    bkt(hr(2026, 5, 23, 2), 2, 0),
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

describe("oldestSampleMs", () => {
  it("takes the oldest bucket's start instant when only buckets exist", () => {
    // Hours out of order: the helper still finds the minimum hour × HOUR_MS.
    const buckets: Bucket[] = [bkt(5, 1, 0), bkt(2, 1, 0), bkt(9, 1, 0)];
    expect(oldestSampleMs(buckets, [])).toBe(2 * HOUR);
  });

  it("takes the oldest reading's `t` when only the recent ring exists", () => {
    const readings: Reading[] = [
      { t: 5 * MIN, up: true },
      { t: 2 * MIN, up: false },
    ];
    expect(oldestSampleMs([], readings)).toBe(2 * MIN);
  });

  it("takes the min across both stores, either one older", () => {
    // Ring older than the oldest bucket start.
    expect(
      oldestSampleMs([bkt(10, 1, 0)], [{ t: 3 * HOUR, up: true }])
    ).toBe(3 * HOUR);
    // Bucket start older than the ring.
    expect(
      oldestSampleMs([bkt(1, 1, 0)], [{ t: 3 * HOUR, up: true }])
    ).toBe(HOUR);
  });

  it("is null when there are no samples at all", () => {
    expect(oldestSampleMs([], [])).toBeNull();
  });

  it("prefers the ring's exact instant when it falls in the oldest bucket's hour", () => {
    // A minutes-old app: its first reading opened the hour-3 bucket at 3h40m.
    // The bucket alone would claim coverage since 3h sharp — up to an hour the
    // app never had, which on the 1h range is the whole window.
    const readings: Reading[] = [
      { t: 3 * HOUR + 40 * MIN, up: true },
      { t: 3 * HOUR + 45 * MIN, up: true },
    ];
    expect(oldestSampleMs([bkt(3, 2, 0)], readings)).toBe(3 * HOUR + 40 * MIN);
  });
});

describe("fixedBarsFromReadings", () => {
  it("holds each reading until the next, so a coarse poll cadence fills the strip (#108)", () => {
    // The shipped default: 5-minute polls against 30 two-minute buckets used to
    // fill ~12 of 30 and leave an alternating comb of gaps.
    const readings: Reading[] = Array.from({ length: 12 }, (_, i) => ({
      t: i * 5 * MIN,
      up: true,
    }));
    const bars = fixedBarsFromReadings(readings, 0, 60 * MIN, 30, 10 * MIN);
    expect(bars).toHaveLength(30);
    expect(bars.map((b) => b.uptime)).toEqual(Array(30).fill(100));
    expect(bars[0].at).toBe("1970-01-01T00:00");
  });

  it("a reading's hold ends at the next reading, not the cap", () => {
    const readings: Reading[] = [
      { t: 0, up: true },
      { t: 4 * MIN, up: false },
    ];
    const bars = fixedBarsFromReadings(readings, 0, 8 * MIN, 4, 10 * MIN);
    expect(bars.map((b) => b.uptime)).toEqual([100, 100, 0, 0]);
  });

  it("caps the hold so a stalled poller still shows a gap", () => {
    const bars = fixedBarsFromReadings(
      [{ t: 0, up: true }],
      0,
      10 * MIN,
      5,
      4 * MIN
    );
    expect(bars.map((b) => b.uptime)).toEqual([100, 100, null, null, null]);
  });

  it("a reading from before the window covers its opening buckets", () => {
    const bars = fixedBarsFromReadings(
      [{ t: -MIN, up: true }],
      0,
      4 * MIN,
      2,
      4 * MIN
    );
    expect(bars.map((b) => b.uptime)).toEqual([100, 100]);
  });

  it("weights readings sharing a bucket by covered time", () => {
    const readings: Reading[] = [
      { t: 0, up: true },
      { t: MIN, up: false },
    ];
    const bars = fixedBarsFromReadings(readings, 0, 2 * MIN, 1, 10 * MIN);
    expect(bars[0].uptime).toBeCloseTo(50, 6);
  });
});

describe("fixedBarsFromBuckets", () => {
  const at = (ms: number) => String(ms);

  it("down-samples several hours into fewer buckets (summing), null where none", () => {
    const buckets: Bucket[] = [
      bkt(0, 3, 1),
      bkt(1, 2, 0),
      bkt(3, 0, 4),
    ];
    const out = fixedBarsFromBuckets(buckets, 0, 4 * HOUR, 2, at);
    expect(out).toHaveLength(2);
    expect(out[0].uptime).toBeCloseTo((5 / 6) * 100, 6); // hours 0+1
    expect(out[1].uptime).toBe(0); // hour 3 only
    expect(out.map((b) => b.at)).toEqual(["0", String(2 * HOUR)]);
  });

  it("up-samples one hour across sub-hour buckets, keeping its ratio (no gaps)", () => {
    const out = fixedBarsFromBuckets([bkt(0, 3, 1)], 0, HOUR, 3, at);
    expect(out).toHaveLength(3);
    for (const b of out) expect(b.uptime).toBeCloseTo(75, 6);
  });

  it("is null for a bucket whose hours have no data", () => {
    const out = fixedBarsFromBuckets([bkt(0, 1, 0)], 0, 2 * HOUR, 2, at);
    expect(out[0].uptime).toBe(100);
    expect(out[1].uptime).toBeNull();
  });

  it("emits a per-bar ms, hour-overlap weighted across boundaries; null where none", () => {
    const buckets: Bucket[] = [
      bkt(0, 3, 1, { count: 3, sum: 300, max: 150 }),
      bkt(1, 2, 0, { count: 2, sum: 500, max: 400 }),
      bkt(3, 0, 4, { count: 0, sum: 0, max: 0 }), // all down: no latency samples
    ];
    const out = fixedBarsFromBuckets(buckets, 0, 4 * HOUR, 2, at);
    // Bar 0 spans hours 0+1: (300 + 500) / (3 + 2) = 160.
    expect(out[0].ms).toBe(160);
    // Bar 1 spans hours 2 (absent) + 3 (all down, msCount 0) → no samples.
    expect(out[1].ms).toBeNull();
  });

  it("keeps a single hour's average when up-sampled across sub-hour bars", () => {
    // Weight cancels within one hour, so every sub-bar shows the hour's average.
    const out = fixedBarsFromBuckets(
      [bkt(0, 4, 0, { count: 4, sum: 800, max: 300 })],
      0,
      HOUR,
      3,
      at
    );
    for (const b of out) expect(b.ms).toBe(200); // 800 / 4
  });
});

describe("fixedBarsFromReadings latency", () => {
  it("time-weights up readings' ms per bar; down/no-ms readings contribute nothing", () => {
    const readings: Reading[] = [
      { t: 0, up: true, ms: 100 },
      { t: 2 * MIN, up: true, ms: 300 },
      { t: 4 * MIN, up: false }, // down: no ms, its bar has no latency
    ];
    const bars = fixedBarsFromReadings(readings, 0, 6 * MIN, 3, 10 * MIN);
    expect(bars[0].ms).toBe(100);
    expect(bars[1].ms).toBe(300);
    expect(bars[2].ms).toBeNull();
  });

  it("averages two up readings sharing a bar, weighted by covered time", () => {
    const readings: Reading[] = [
      { t: 0, up: true, ms: 100 }, // covers [0, 1min)
      { t: MIN, up: true, ms: 300 }, // covers [1min, 2min)
    ];
    const bars = fixedBarsFromReadings(readings, 0, 2 * MIN, 1, 10 * MIN);
    expect(bars[0].ms).toBe(200); // (100·1min + 300·1min) / 2min
  });

  it("is null for a bar covered only by a reading with no ms", () => {
    const bars = fixedBarsFromReadings([{ t: 0, up: true }], 0, 2 * MIN, 1, 10 * MIN);
    expect(bars[0].uptime).toBe(100); // still up
    expect(bars[0].ms).toBeNull(); // but no latency sample
  });
});

describe("latencyOverBuckets", () => {
  it("averages by msCount and tracks the max over buckets in the window", () => {
    const buckets: Bucket[] = [
      bkt(hr(2026, 5, 23, 1), 3, 1, { count: 3, sum: 300, max: 150 }),
      bkt(hr(2026, 5, 23, 2), 2, 0, { count: 2, sum: 500, max: 400 }),
    ];
    // (300 + 500) / (3 + 2) = 160, max = 400.
    expect(latencyOverBuckets(buckets, hr(2026, 5, 23, 1))).toEqual({
      avg: 160,
      max: 400,
    });
    // Only the second hour: 500 / 2 = 250.
    expect(latencyOverBuckets(buckets, hr(2026, 5, 23, 2))).toEqual({
      avg: 250,
      max: 400,
    });
  });

  it("returns null when no bucket in the window carries a latency sample", () => {
    expect(latencyOverBuckets([bkt(0, 4, 0)], 0)).toBeNull(); // msCount 0
    expect(latencyOverBuckets([], 0)).toBeNull();
  });

  it("divides by msCount, not up, so pre-upgrade buckets don't distort the avg", () => {
    const buckets: Bucket[] = [
      bkt(0, 10, 0), // legacy hour: 10 up checks, no latency recorded
      bkt(1, 2, 0, { count: 2, sum: 400, max: 250 }),
    ];
    // 400 / 2 (msCount) = 200, NOT 400 / 12 (up) = 33.
    expect(latencyOverBuckets(buckets, 0)).toEqual({ avg: 200, max: 250 });
  });
});

describe("recentLatency", () => {
  const now = Date.UTC(2026, 5, 23, 12, 30);
  const readings: Reading[] = [
    { t: now - 90 * MIN, up: true, ms: 999 }, // outside the 60-minute window
    { t: now - 40 * MIN, up: false }, // down: no ms
    { t: now - 30 * MIN, up: false, ms: 5000 }, // even a down carrying ms is skipped
    { t: now - 10 * MIN, up: true, ms: 100 },
    { t: now - 5 * MIN, up: true, ms: 300 },
  ];
  const since = now - 60 * MIN;

  it("averages up readings' ms in the window and tracks max, ignoring the rest", () => {
    expect(recentLatency(readings, since)).toEqual({ avg: 200, max: 300 });
  });

  it("returns null when no up reading with ms falls in the window", () => {
    expect(recentLatency(readings, now + MIN)).toBeNull();
    expect(recentLatency([], since)).toBeNull();
    expect(recentLatency([{ t: now, up: false }], since)).toBeNull();
  });
});

describe("recordResults latency accumulation", () => {
  beforeEach(resetHistoryState);

  it("tallies msCount/msSum/msMax for up results and skips down results' ms", () => {
    const id = "rec-lat";
    const now = Date.now();
    recordResults(
      [
        { id, up: true, status: 200, ms: 100 },
        { id, up: true, status: 200, ms: 300 },
        { id, up: false, status: null, ms: 5000 }, // time-to-failure: excluded
      ],
      now
    );
    const h = getHistory([id]).apps[0];
    // avg over the two up checks = 200, max = 300; the 5000ms failure is ignored.
    expect(h.latency.d1).toEqual({ avg: 200, max: 300 });
    expect(h.latency.h1).toEqual({ avg: 200, max: 300 });
    // Uptime still counts the down check: 2 up of 3.
    expect(h.uptime.d1).toBeCloseTo((2 / 3) * 100, 6);
  });
});

describe("recordResults downSince (current-outage tracking)", () => {
  beforeEach(resetHistoryState);

  it("marks the first down poll and holds it across consecutive downs", () => {
    const id = "out";
    const t0 = Date.now();
    recordResults([{ id, up: false, status: 503, ms: 5000 }], t0);
    expect(getHistory([id]).apps[0].downSince).toBe(t0);
    // A later down poll must NOT move the mark — it's the outage's start, not
    // the latest failure.
    recordResults([{ id, up: false, status: 503, ms: 5000 }], t0 + 5 * MIN);
    expect(getHistory([id]).apps[0].downSince).toBe(t0);
  });

  it("clears the mark when the app comes back up", () => {
    const id = "recover";
    const t0 = Date.now();
    recordResults([{ id, up: false, status: 503, ms: 5000 }], t0);
    expect(getHistory([id]).apps[0].downSince).toBe(t0);
    recordResults([{ id, up: true, status: 200, ms: 100 }], t0 + MIN);
    expect(getHistory([id]).apps[0].downSince).toBeNull();
  });

  it("re-marks a fresh outage at the new down time after a recovery", () => {
    const id = "flap";
    const t0 = Date.now();
    recordResults([{ id, up: false, status: 503, ms: 5000 }], t0);
    recordResults([{ id, up: true, status: 200, ms: 100 }], t0 + MIN);
    recordResults([{ id, up: false, status: 503, ms: 5000 }], t0 + 2 * MIN);
    // A new outage gets a new start, not the resurrected old one.
    expect(getHistory([id]).apps[0].downSince).toBe(t0 + 2 * MIN);
  });

  it("surfaces null for an app that has only ever been up", () => {
    const id = "healthy";
    recordResults([{ id, up: true, status: 200, ms: 100 }], Date.now());
    expect(getHistory([id]).apps[0].downSince).toBeNull();
  });
});

describe("loadHistory / flush persistence", () => {
  let dir: string;

  beforeEach(async () => {
    resetHistoryState();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctrlcenter-hist-"));
    process.env.CONFIG_PATH = path.join(dir, "config.yaml");
  });

  it("loads an old-format file (2-tuples, no recent ms) with no latency data", async () => {
    const now = Date.now();
    const old = {
      apps: { a: { [hourOf(now)]: [3, 1] } }, // legacy [up, down] only
      recent: { a: [[now, 1]] }, // legacy [t, up01] only
    };
    await fs.writeFile(
      path.join(dir, "status-history.json"),
      JSON.stringify(old),
      "utf8"
    );
    await loadHistory();
    const h = getHistory(["a"]).apps[0];
    expect(h.uptime.d1).toBeCloseTo(75, 6); // 3 up / 4 loaded fine
    expect(h.latency.d1).toBeNull(); // but no latency data
    expect(h.latency.h1).toBeNull();
  });

  it("round-trips the new format through flush → load", async () => {
    const now = Date.now();
    recordResults(
      [
        { id: "b", up: true, status: 200, ms: 100 },
        { id: "b", up: true, status: 200, ms: 300 },
        { id: "b", up: false, status: null, ms: 5000 },
      ],
      now
    );
    await flush();
    // Drop the in-memory store and reload strictly from the file flush wrote.
    resetHistoryState();
    await loadHistory();
    const h = getHistory(["b"]).apps[0];
    expect(h.latency.d1).toEqual({ avg: 200, max: 300 });
    expect(h.latency.h1).toEqual({ avg: 200, max: 300 });
    expect(h.uptime.d1).toBeCloseTo((2 / 3) * 100, 6);
  });

  it("round-trips downSince (current-outage mark) through flush → load", async () => {
    const t0 = Date.now();
    recordResults([{ id: "c", up: false, status: 503, ms: 5000 }], t0);
    await flush();
    // Drop the in-memory state (downSince included) and reload from the file.
    resetHistoryState();
    await loadHistory();
    expect(getHistory(["c"]).apps[0].downSince).toBe(t0);
  });

  it("loads a file without a downSince key with no outage marks", async () => {
    const now = Date.now();
    // A down bucket but no downSince key (an older file): the app has history
    // yet no current-outage mark until the next down poll re-establishes one.
    await fs.writeFile(
      path.join(dir, "status-history.json"),
      JSON.stringify({ apps: { a: { [hourOf(now)]: [0, 2] } }, recent: {} }),
      "utf8"
    );
    await loadHistory();
    expect(getHistory(["a"]).apps[0].downSince).toBeNull();
  });
});
