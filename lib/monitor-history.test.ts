import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { historyOf, loadHistory, metricsOf, recordSnapshot, resetHistory, forgetHistory, writeSpool } from "./monitor-history";

// The Monitor's recorded history (#530): readings from the snapshots, a
// minute to a slot, charted as the last hour or the last day, and kept
// across a restart in a spool beside the config.
const MIN = 60_000;
const T0 = Date.parse("2026-11-15T12:00:00Z");
let dir: string;

beforeEach(() => {
  resetHistory();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrl-history-"));
  vi.stubEnv("CONFIG_PATH", path.join(dir, "config.yaml"));
});
afterEach(() => {
  resetHistory();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("metricsOf", () => {
  it("takes each type's numbers worth charting, and nothing it can't read", () => {
    expect(metricsOf("qbittorrent", { downSpeed: 100, upSpeed: 20, torrents: [] })).toEqual({ down: 100, up: 20 });
    expect(metricsOf("unifi", { clients: { total: 20, wireless: 13, wired: 7 }, internet: { latencyMs: 11, downRate: null } })).toEqual({
      clients: 20,
      wifi: 13,
      wired: 7,
      latency: 11,
    });
    expect(metricsOf("truenas", { pools: [{ usedRatio: 0.4 }, { usedRatio: 0.9 }], apps: [{ running: true }, { running: false }] })).toEqual({
      used: 0.9,
      apps: 1,
    });
    expect(metricsOf("sonarr", { upcoming: [] })).toBeNull();
    expect(metricsOf("qbittorrent", null)).toBeNull();
    expect(metricsOf("seerr", { pending: "3" })).toBeNull();
  });
});

describe("recording and reading back", () => {
  it("keeps one reading a minute, the latest winning, and charts the hour with gaps", () => {
    recordSnapshot("qb", "qbittorrent", { downSpeed: 10, upSpeed: 1 }, T0 - 5 * MIN);
    recordSnapshot("qb", "qbittorrent", { downSpeed: 30, upSpeed: 3 }, T0 - 2 * MIN + 1_000);
    recordSnapshot("qb", "qbittorrent", { downSpeed: 50, upSpeed: 5 }, T0 - 2 * MIN + 40_000);
    // An older reading than the last is out of order and dropped.
    recordSnapshot("qb", "qbittorrent", { downSpeed: 99, upSpeed: 9 }, T0 - 10 * MIN);
    const h = historyOf("qb", "hour", T0);
    expect(h.at).toHaveLength(60);
    expect(h.at[59]).toBe(T0);
    expect(h.series.down.slice(-6)).toEqual([10, null, null, 50, null, null]);
    expect(h.series.up.filter((v) => v !== null)).toEqual([1, 5]);
    expect(historyOf("nobody", "hour", T0).series).toEqual({});
  });

  it("averages the day into 15-minute steps and lets readings past a day go", () => {
    recordSnapshot("tt", "tautulli", { streamCount: 1, transcodeCount: 0 }, T0 - 25 * 60 * MIN);
    recordSnapshot("tt", "tautulli", { streamCount: 2, transcodeCount: 0 }, T0 - 14 * MIN);
    recordSnapshot("tt", "tautulli", { streamCount: 4, transcodeCount: 1 }, T0 - 13 * MIN);
    const h = historyOf("tt", "day", T0);
    expect(h.at).toHaveLength(96);
    expect(h.series.streams.filter((v) => v !== null)).toEqual([3]);
    expect(h.series.transcodes.filter((v) => v !== null)).toEqual([0.5]);
  });

  it("forgets the integrations that are gone", () => {
    recordSnapshot("a", "seerr", { pending: 1, processing: 0 }, T0);
    recordSnapshot("b", "seerr", { pending: 2, processing: 0 }, T0);
    forgetHistory((id) => id === "b");
    expect(historyOf("a", "hour", T0).series).toEqual({});
    expect(historyOf("b", "hour", T0).series.pending.at(-1)).toBe(2);
  });
});

describe("the spool", () => {
  it("writes the readings privately and reads them back after a restart", async () => {
    recordSnapshot("qb", "qbittorrent", { downSpeed: 10, upSpeed: 1 }, Date.now() - 3 * MIN);
    await writeSpool();
    const file = path.join(dir, "monitor-history.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    resetHistory();
    // A reading made before the spool is read is kept beside it.
    recordSnapshot("qb", "qbittorrent", { downSpeed: 20, upSpeed: 2 }, Date.now());
    await loadHistory();
    expect(historyOf("qb", "hour").series.down.filter((v) => v !== null)).toEqual([10, 20]);
  });

  it("starts empty from a missing, corrupt or foreign spool", async () => {
    await loadHistory();
    expect(historyOf("qb", "hour").series).toEqual({});
    for (const text of ["{nope", JSON.stringify({ version: 2, series: { qb: { type: "qbittorrent", readings: [] } } })]) {
      resetHistory();
      fs.writeFileSync(path.join(dir, "monitor-history.json"), text);
      await loadHistory();
      expect(historyOf("qb", "hour").series).toEqual({});
    }
  });
});
