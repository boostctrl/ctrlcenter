import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The background poller's tick (#289): when it checks, and the order of the
// record → prune → flush → alert steps. Every collaborator is mocked.
const calls: string[] = [];
let settings: {
  statusChecks: boolean;
  statusInterval?: number;
  alerts: object;
  statusAnnouncements: object[];
};
let apps: { id: string; interval?: number; monitor?: boolean }[];

vi.mock("./config", () => ({
  readConfigInternal: vi.fn(async () => ({ settings, apps })),
}));
// A check for "slow" waits until the test calls releaseSlow.
let releaseSlow: () => void = () => {};
vi.mock("./status-check", () => ({
  CHECK_CONCURRENCY: 4,
  checkSignature: (app: { id: string }) => `sig:${app.id}`,
  checkApp: vi.fn(async (app: { id: string }) => {
    calls.push(`check:${app.id}`);
    if (app.id === "boom") throw new Error("socket hang up");
    if (app.id === "slow") await new Promise<void>((r) => (releaseSlow = r));
    return { up: true, status: 200, ms: 5 };
  }),
}));
vi.mock("./status-history", () => ({
  loadHistory: vi.fn(async () => {}),
  priorDownStreaks: vi.fn(() => {
    calls.push("prior");
    return new Map();
  }),
  recordResults: vi.fn(() => calls.push("record")),
  pruneHistory: vi.fn((ids: string[]) => calls.push(`prune:${ids.join(",")}`)),
  flush: vi.fn(async () => calls.push("flush")),
}));
vi.mock("./alerts", () => ({
  processAlerts: vi.fn(async () => calls.push("alerts")),
}));
const warn = vi.fn();
vi.mock("./log", () => ({
  log: { warn: (...a: unknown[]) => warn(...a), info: vi.fn() },
  errorReason: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

let tick: () => Promise<void>;
let latestCheck: typeof import("./status-latest").latestCheck;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
  calls.length = 0;
  warn.mockClear();
  settings = { statusChecks: true, statusInterval: 5, alerts: {}, statusAnnouncements: [] };
  apps = [{ id: "a" }, { id: "b" }];
  vi.resetModules(); // fresh per-app schedule per test
  ({ tick } = await import("./status-poller"));
  const latest = await import("./status-latest");
  latest.clearLatestChecks();
  ({ latestCheck } = latest);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("status poller tick", () => {
  it("does nothing while status checks are off, or with no apps", async () => {
    settings.statusChecks = false;
    await tick();
    settings.statusChecks = true;
    apps = [];
    await tick();
    expect(calls).toEqual([]);
  });

  it("checks every app, then reads prior state BEFORE recording, prunes, flushes, alerts", async () => {
    await tick();
    expect(calls).toEqual([
      "check:a",
      "check:b",
      "prior",
      "record",
      "prune:a,b",
      "flush",
      "alerts",
    ]);
  });

  it("publishes each check for /api/status to serve (#278)", async () => {
    await tick();
    expect(latestCheck("a")).toEqual({
      result: { id: "a", up: true, status: 200, ms: 5 },
      at: Date.now(),
      signature: "sig:a",
    });
  });

  it("skips apps with monitoring off but keeps their history (#296)", async () => {
    apps = [{ id: "a" }, { id: "b", monitor: false }];
    await tick();
    expect(calls.filter((c) => c.startsWith("check:"))).toEqual(["check:a"]);
    expect(calls).toContain("prune:a,b");
  });

  it("records apps under maintenance as such and keeps them out of alerting (#293)", async () => {
    const { recordResults } = await import("./status-history");
    const { processAlerts } = await import("./alerts");
    settings.statusAnnouncements = [
      { id: "m", kind: "maintenance", title: "", body: "", startsAt: "", endsAt: "", apps: ["b"] },
    ];
    await tick();
    expect(vi.mocked(recordResults).mock.lastCall?.[2]).toEqual(new Set(["b"]));
    const alerted = vi.mocked(processAlerts).mock.lastCall?.[0] as { id: string }[];
    expect(alerted.map((r) => r.id)).toEqual(["a"]);
  });

  it("checks each app on its own interval (#292)", async () => {
    apps = [{ id: "a" }, { id: "b", interval: 1 }];
    await tick();
    expect(calls.filter((c) => c.startsWith("check:"))).toEqual(["check:a", "check:b"]);
    calls.length = 0;
    vi.advanceTimersByTime(60_000);
    await tick();
    // Only b's 1-minute interval has passed; a waits out the global 5.
    expect(calls.filter((c) => c.startsWith("check:"))).toEqual(["check:b"]);
  });

  it("waits out the configured interval between rounds", async () => {
    await tick();
    calls.length = 0;
    vi.advanceTimersByTime(4 * 60_000);
    await tick();
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(60_000);
    await tick();
    expect(calls).toContain("check:a");
  });

  it("passes each app's interval to the prior-state read", async () => {
    const { priorDownStreaks } = await import("./status-history");
    apps = [{ id: "a" }, { id: "b", interval: 1 }];
    await tick();
    expect(vi.mocked(priorDownStreaks).mock.lastCall?.[0]).toEqual([
      { id: "a", intervalMs: 5 * 60_000 },
      { id: "b", intervalMs: 60_000 },
    ]);
  });

  it("runs one round at a time: a tick during a slow round is skipped (#391)", async () => {
    apps = [{ id: "slow" }, { id: "b", interval: 1 }];
    const first = tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((c) => c.startsWith("check:"))).toEqual(["check:slow", "check:b"]);
    // A minute on, b is due again, but the first round hasn't recorded yet.
    calls.length = 0;
    vi.advanceTimersByTime(60_000);
    await tick();
    expect(calls).toEqual([]);
    releaseSlow();
    await first;
    expect(calls).toEqual(["prior", "record", "prune:slow,b", "flush", "alerts"]);
    // Once it's done, the next tick runs.
    calls.length = 0;
    await tick();
    expect(calls).toContain("check:b");
  });

  it("logs a failed round instead of throwing, and stops before recording", async () => {
    apps = [{ id: "boom" }];
    await expect(tick()).resolves.toBeUndefined();
    expect(calls).not.toContain("record");
    expect(warn).toHaveBeenCalledWith("status poll tick failed", { reason: "socket hang up" });
  });
});
