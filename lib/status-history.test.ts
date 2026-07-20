import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  extractOutages,
  loadHistory,
  flush,
  recordResults,
  setOutageNote,
  getHistory,
  getAppDetail,
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
    outages: Map<string, unknown>;
  };
};
function resetHistoryState() {
  const s = g.__ctrlcenterStatusHistory;
  if (s) {
    s.loaded = false;
    s.store = new Map();
    s.recent = new Map();
    s.downSince = new Map();
    s.outages = new Map();
  }
}

// CONFIG_PATH is a shared, mutable env var: once a persistence test points it at
// a throwaway dir it stays pointed there, so any later loadHistory() silently
// reads whatever file the previous test wrote. Capture the original and restore
// it after every test so that cross-describe leak can't happen (#182).
const ORIGINAL_CONFIG_PATH = process.env.CONFIG_PATH;
afterEach(() => {
  if (ORIGINAL_CONFIG_PATH === undefined) delete process.env.CONFIG_PATH;
  else process.env.CONFIG_PATH = ORIGINAL_CONFIG_PATH;
});

// One isolated on-disk history for a single test: a new empty temp dir, with
// CONFIG_PATH pointed inside it and the in-memory store cleared. Every test that
// calls loadHistory()/flush() must start from one of these so it never inherits
// another test's file. Returns the dir for tests that need to seed a file.
async function freshHistoryDir(): Promise<string> {
  resetHistoryState();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctrlcenter-hist-"));
  process.env.CONFIG_PATH = path.join(dir, "config.yaml");
  return dir;
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

describe("recordResults completed-outage records (#175)", () => {
  beforeEach(resetHistoryState);

  it("records the exact {start, end} pair at the recovery poll", () => {
    const id = "rec";
    const t0 = Date.now() - 30 * MIN;
    recordResults([{ id, up: false, status: 503, ms: 5000 }], t0);
    recordResults([{ id, up: false, status: 503, ms: 5000 }], t0 + 5 * MIN);
    recordResults([{ id, up: true, status: 200, ms: 100 }], t0 + 10 * MIN);
    // One entry, not one recorded + one re-derived from the ring.
    expect(getAppDetail(id, "UTC", 5).outages).toEqual([
      { startMs: t0, endMs: t0 + 10 * MIN, downMs: 10 * MIN, exact: true, recorded: true },
    ]);
  });

  it("keeps an outage exact after the ring ages it out", () => {
    const id = "aged";
    const now = Date.now();
    const t0 = now - 3 * HOUR;
    recordResults([{ id, up: false, status: 503, ms: 5000 }], t0);
    recordResults([{ id, up: true, status: 200, ms: 100 }], t0 + 10 * MIN);
    // Hours later a fresh poll prunes those readings out of the recent ring —
    // before #175 the outage degraded to hour-granular bucket bounds here.
    recordResults([{ id, up: true, status: 200, ms: 100 }], now);
    expect(getAppDetail(id, "UTC", 5).outages).toEqual([
      { startMs: t0, endMs: t0 + 10 * MIN, downMs: 10 * MIN, exact: true, recorded: true },
    ]);
  });

  it("caps stored records, dropping the oldest first", () => {
    const id = "flappy";
    const base = Date.now() - 20 * HOUR;
    // A service flapping every poll: 520 completed outages, 2 minutes apart.
    for (let i = 0; i < 520; i++) {
      recordResults([{ id, up: false, status: 503, ms: 5000 }], base + i * 2 * MIN);
      recordResults([{ id, up: true, status: 200, ms: 50 }], base + i * 2 * MIN + MIN);
    }
    const list = g.__ctrlcenterStatusHistory!.outages.get(id) as {
      start: number;
    }[];
    expect(list).toHaveLength(500);
    expect(list[list.length - 1].start).toBe(base + 519 * 2 * MIN);
    expect(list[0].start).toBe(base + 20 * 2 * MIN); // oldest 20 dropped
  });
});

describe("loadHistory / flush persistence", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await freshHistoryDir();
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

  it("round-trips recorded outages through flush → load (#175)", async () => {
    const t0 = Date.now() - 30 * MIN;
    recordResults([{ id: "d", up: false, status: 503, ms: 5000 }], t0);
    recordResults([{ id: "d", up: true, status: 200, ms: 100 }], t0 + 5 * MIN);
    await flush();
    resetHistoryState();
    await loadHistory();
    expect(getAppDetail("d", "UTC", 5).outages).toEqual([
      { startMs: t0, endMs: t0 + 5 * MIN, downMs: 5 * MIN, exact: true, recorded: true },
    ]);
  });

  it("round-trips an incident note through flush → load (#176)", async () => {
    const t0 = Date.now() - 30 * MIN;
    recordResults([{ id: "e", up: false, status: 503, ms: 5000 }], t0);
    recordResults([{ id: "e", up: true, status: 200, ms: 100 }], t0 + 5 * MIN);
    expect(setOutageNote("e", t0, "planned maintenance")).toBe(true);
    await flush();
    resetHistoryState();
    await loadHistory();
    expect(getAppDetail("e", "UTC", 5).outages[0].note).toBe(
      "planned maintenance"
    );
  });

  it("loads a file without an outages key; bucket reconstruction still applies", async () => {
    const now = Date.now();
    // A pre-#175 file: downtime exists only as hour tallies. The log falls
    // back to the hour-granular reconstruction, tagged approximate.
    await fs.writeFile(
      path.join(dir, "status-history.json"),
      JSON.stringify({ apps: { a: { [hourOf(now)]: [0, 2] } }, recent: {} }),
      "utf8"
    );
    await loadHistory();
    const outages = getAppDetail("a", "UTC", 5).outages;
    expect(outages).toHaveLength(1);
    expect(outages[0].exact).toBe(false);
  });

  it("prunes recorded outages past retention on load", async () => {
    const now = Date.now();
    await fs.writeFile(
      path.join(dir, "status-history.json"),
      JSON.stringify({
        apps: {},
        recent: {},
        outages: {
          a: [
            [now - 100 * 24 * HOUR, now - 100 * 24 * HOUR + 10 * MIN],
            [now - 60 * MIN, now - 50 * MIN],
          ],
        },
      }),
      "utf8"
    );
    await loadHistory();
    expect(getAppDetail("a", "UTC", 5).outages).toEqual([
      { startMs: now - 60 * MIN, endMs: now - 50 * MIN, downMs: 10 * MIN, exact: true, recorded: true },
    ]);
  });
});

describe("extractOutages", () => {
  const HOUR = 3_600_000;
  const MIN = 60_000;
  // A quiet, data-carrying hour bucket (no downtime).
  const upHour = (hour: number): Bucket => ({
    hour, up: 12, down: 0, msCount: 12, msSum: 240, msMax: 40,
  });
  const downHour = (hour: number, down: number): Bucket => ({
    hour, up: 12 - down, down, msCount: 12 - down, msSum: 200, msMax: 40,
  });

  it("returns nothing for a clean history", () => {
    const now = 100 * HOUR;
    const buckets = [upHour(96), upHour(97), upHour(98)];
    const readings: Reading[] = [
      { t: now - 10 * MIN, up: true, ms: 20 },
      { t: now - 5 * MIN, up: true, ms: 22 },
    ];
    expect(extractOutages([], buckets, readings, null, now, 5)).toEqual([]);
  });

  it("derives a poll-exact completed outage from the recent ring", () => {
    const now = 100 * HOUR;
    const readings: Reading[] = [
      { t: now - 40 * MIN, up: true, ms: 20 },
      { t: now - 35 * MIN, up: false },
      { t: now - 30 * MIN, up: false },
      { t: now - 25 * MIN, up: true, ms: 21 },
      { t: now - 20 * MIN, up: true, ms: 20 },
    ];
    expect(extractOutages([], [], readings, null, now, 5)).toEqual([
      {
        startMs: now - 35 * MIN,
        endMs: now - 25 * MIN,
        downMs: 10 * MIN,
        exact: true,
      },
    ]);
  });

  it("represents the ongoing outage once, from the persisted downSince mark", () => {
    const now = 100 * HOUR;
    const downSince = now - 50 * MIN; // pre-dates the ring's oldest reading
    const readings: Reading[] = [
      { t: now - 30 * MIN, up: false },
      { t: now - 25 * MIN, up: false },
      { t: now - 20 * MIN, up: false },
    ];
    // The down readings inside the ongoing outage must not become a second row.
    expect(extractOutages([], [], readings, downSince, now, 5)).toEqual([
      { startMs: downSince, endMs: null, downMs: 50 * MIN, exact: true },
    ]);
  });

  it("falls back to the ring for an ongoing outage without a mark (old file)", () => {
    const now = 100 * HOUR;
    const readings: Reading[] = [
      { t: now - 20 * MIN, up: true, ms: 20 },
      { t: now - 15 * MIN, up: false },
      { t: now - 10 * MIN, up: false },
    ];
    expect(extractOutages([], [], readings, null, now, 5)).toEqual([
      { startMs: now - 15 * MIN, endMs: null, downMs: 15 * MIN, exact: true },
    ]);
  });

  it("derives hour-granular outages from old buckets, with estimated downtime", () => {
    const now = 200 * HOUR;
    // Downtime across two consecutive hours (3 + 6 down checks at 5min each),
    // then a clean hour, then one more bad hour.
    const buckets = [
      downHour(100, 3),
      downHour(101, 6),
      upHour(102),
      downHour(103, 2),
      upHour(104),
    ];
    expect(extractOutages([], buckets, [], null, now, 5)).toEqual([
      // Newest first.
      {
        startMs: 103 * HOUR,
        endMs: 104 * HOUR,
        downMs: 2 * 5 * MIN,
        exact: false,
      },
      {
        startMs: 100 * HOUR,
        endMs: 102 * HOUR,
        downMs: 9 * 5 * MIN,
        exact: false,
      },
    ]);
  });

  it("breaks a bucket run at an unwatched hour instead of bridging the gap", () => {
    const now = 200 * HOUR;
    // Hours 100 and 102 saw downtime; hour 101 has NO bucket (server off) — an
    // unwatched gap must not read as one long outage.
    const buckets = [downHour(100, 2), downHour(102, 2)];
    const out = extractOutages([], buckets, [], null, now, 5);
    expect(out).toHaveLength(2);
    expect(out[0].startMs).toBe(102 * HOUR);
    expect(out[1].startMs).toBe(100 * HOUR);
  });

  it("does not re-list bucket hours the ring already covers", () => {
    const now = 100 * HOUR + 30 * MIN;
    // The current hour's bucket recorded the same downtime the ring shows.
    const buckets = [downHour(100, 2)];
    const readings: Reading[] = [
      { t: 100 * HOUR + 5 * MIN, up: true, ms: 20 },
      { t: 100 * HOUR + 10 * MIN, up: false },
      { t: 100 * HOUR + 15 * MIN, up: false },
      { t: 100 * HOUR + 20 * MIN, up: true, ms: 21 },
    ];
    expect(extractOutages([], buckets, readings, null, now, 5)).toEqual([
      {
        startMs: 100 * HOUR + 10 * MIN,
        endMs: 100 * HOUR + 20 * MIN,
        downMs: 10 * MIN,
        exact: true,
      },
    ]);
  });

  it("merges one outage straddling the bucket/ring seam into a single entry", () => {
    const now = 101 * HOUR + 30 * MIN;
    // Bucket hour 100 ends at 101h; the ring starts at 101h with the SAME
    // outage still down, recovering at 101h+10m. Two runs, one real outage.
    const buckets = [downHour(100, 6)];
    const readings: Reading[] = [
      { t: 101 * HOUR, up: false },
      { t: 101 * HOUR + 5 * MIN, up: false },
      { t: 101 * HOUR + 10 * MIN, up: true, ms: 20 },
    ];
    const out = extractOutages([], buckets, readings, null, now, 5);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      startMs: 100 * HOUR,
      endMs: 101 * HOUR + 10 * MIN,
      downMs: 6 * 5 * MIN + 10 * MIN,
      exact: false, // one side is hour-granular, so the whole entry is
    });
  });

  it("caps the list and returns newest first", () => {
    const now = 500 * HOUR;
    // 25 isolated bad hours, separated by clean gaps.
    const buckets: Bucket[] = [];
    for (let i = 0; i < 25; i++) buckets.push(downHour(100 + i * 2, 1));
    const out = extractOutages([], buckets, [], null, now, 5);
    expect(out).toHaveLength(20);
    expect(out[0].startMs).toBe((100 + 24 * 2) * HOUR);
    expect(out[0].startMs).toBeGreaterThan(out[19].startMs);
  });

  it("lists a recorded outage exact at any age (#175)", () => {
    const now = 500 * HOUR;
    // Far older than the ring could ever hold; no other data at all.
    const recorded = [{ start: 100 * HOUR + 7 * MIN, end: 100 * HOUR + 23 * MIN }];
    expect(extractOutages(recorded, [], [], null, now, 5)).toEqual([
      {
        startMs: 100 * HOUR + 7 * MIN,
        endMs: 100 * HOUR + 23 * MIN,
        downMs: 16 * MIN,
        exact: true,
        recorded: true,
      },
    ]);
  });

  it("does not re-derive a recorded outage from its bucket tallies", () => {
    const now = 200 * HOUR;
    // The same outage exists as an exact record AND as hour-bucket down
    // tallies. The log must show one exact entry — not an approximate twin,
    // and not a merged entry with doubled downtime.
    const recorded = [{ start: 100 * HOUR + 10 * MIN, end: 100 * HOUR + 40 * MIN }];
    const buckets = [downHour(100, 6)];
    expect(extractOutages(recorded, buckets, [], null, now, 5)).toEqual([
      {
        startMs: 100 * HOUR + 10 * MIN,
        endMs: 100 * HOUR + 40 * MIN,
        downMs: 30 * MIN,
        exact: true,
        recorded: true,
      },
    ]);
  });

  it("does not re-derive a recorded outage still visible in the ring", () => {
    const now = 100 * HOUR;
    const recorded = [{ start: now - 35 * MIN, end: now - 25 * MIN }];
    const readings: Reading[] = [
      { t: now - 40 * MIN, up: true, ms: 20 },
      { t: now - 35 * MIN, up: false },
      { t: now - 30 * MIN, up: false },
      { t: now - 25 * MIN, up: true, ms: 21 },
    ];
    expect(extractOutages(recorded, [], readings, null, now, 5)).toEqual([
      {
        startMs: now - 35 * MIN,
        endMs: now - 25 * MIN,
        downMs: 10 * MIN,
        exact: true,
        recorded: true,
      },
    ]);
  });

  it("keeps the bucket fallback for spans before the first recorded outage", () => {
    const now = 300 * HOUR;
    // Pre-upgrade downtime (hour 100) has no record; an outage recorded later
    // must not suppress its reconstruction — only hours at/after itself.
    const recorded = [{ start: 200 * HOUR + 5 * MIN, end: 200 * HOUR + 15 * MIN }];
    const buckets = [downHour(100, 3), downHour(200, 2)];
    expect(extractOutages(recorded, buckets, [], null, now, 5)).toEqual([
      {
        startMs: 200 * HOUR + 5 * MIN,
        endMs: 200 * HOUR + 15 * MIN,
        downMs: 10 * MIN,
        exact: true,
        recorded: true,
      },
      {
        startMs: 100 * HOUR,
        endMs: 101 * HOUR,
        downMs: 3 * 5 * MIN,
        exact: false,
      },
    ]);
  });

  it("drops recorded outages older than the retention window", () => {
    const now = 100 * 24 * HOUR;
    const recorded = [
      { start: HOUR, end: 2 * HOUR }, // ended ~100 days before `now`
      { start: 99 * 24 * HOUR, end: 99 * 24 * HOUR + 10 * MIN },
    ];
    const out = extractOutages(recorded, [], [], null, now, 5);
    expect(out).toHaveLength(1);
    expect(out[0].startMs).toBe(99 * 24 * HOUR);
  });

  it("carries the incident note on a recorded entry (#176)", () => {
    const now = 200 * HOUR;
    const recorded = [
      { start: 100 * HOUR, end: 100 * HOUR + 10 * MIN, note: "ISP fault" },
      { start: 150 * HOUR, end: 150 * HOUR + 5 * MIN },
    ];
    const out = extractOutages(recorded, [], [], null, now, 5);
    expect(out[0].note).toBeUndefined(); // newest first, no note set
    expect(out[1].note).toBe("ISP fault");
  });

  it("keeps recorded outages separate even within the poll hold (#176)", () => {
    const now = 200 * HOUR;
    // Two real outages one poll apart. The seam merge must not fold them into
    // one row: each carries its own identity (startMs) for its note.
    const recorded = [
      { start: 100 * HOUR, end: 100 * HOUR + 5 * MIN, note: "first" },
      { start: 100 * HOUR + 10 * MIN, end: 100 * HOUR + 15 * MIN, note: "second" },
    ];
    const out = extractOutages(recorded, [], [], null, now, 5);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.note)).toEqual(["second", "first"]);
  });
});

describe("setOutageNote (#176)", () => {
  beforeEach(resetHistoryState);

  const recordOutage = (id: string, t0: number) => {
    recordResults([{ id, up: false, status: 503, ms: 5000 }], t0);
    recordResults([{ id, up: true, status: 200, ms: 100 }], t0 + 5 * MIN);
  };

  it("sets, replaces, and clears the note on a recorded outage", () => {
    const t0 = Date.now() - 30 * MIN;
    recordOutage("n", t0);
    expect(setOutageNote("n", t0, "power outage")).toBe(true);
    expect(getAppDetail("n", "UTC", 5).outages[0].note).toBe("power outage");
    expect(setOutageNote("n", t0, "ISP fault")).toBe(true);
    expect(getAppDetail("n", "UTC", 5).outages[0].note).toBe("ISP fault");
    expect(setOutageNote("n", t0, "")).toBe(true);
    expect(getAppDetail("n", "UTC", 5).outages[0].note).toBeUndefined();
  });

  it("returns false when no record anchors the start instant", () => {
    const t0 = Date.now() - 30 * MIN;
    recordOutage("n", t0);
    expect(setOutageNote("n", t0 + 1, "off by one")).toBe(false);
    expect(setOutageNote("other", t0, "wrong app")).toBe(false);
    expect(getAppDetail("n", "UTC", 5).outages[0].note).toBeUndefined();
  });
});

describe("getAppDetail", () => {
  beforeEach(freshHistoryDir);

  it("returns detail-resolution series plus the outage log", async () => {
    await loadHistory();
    const now = Date.now();
    recordResults([{ id: "a", up: true, status: 200, ms: 30 }], now - 10 * 60_000);
    recordResults([{ id: "a", up: false, status: null, ms: 5000 }], now - 5 * 60_000);
    recordResults([{ id: "a", up: true, status: 200, ms: 32 }], now - 60_000);
    const detail = getAppDetail("a", "UTC", 5);
    expect(detail.id).toBe("a");
    expect(detail.series.h1).toHaveLength(90);
    expect(detail.series.d90).toHaveLength(90);
    expect(detail.outages).toHaveLength(1);
    expect(detail.outages[0]).toMatchObject({
      startMs: now - 5 * 60_000,
      endMs: now - 60_000,
      exact: true,
    });
    expect(detail.downSince).toBeNull();
  });
});
