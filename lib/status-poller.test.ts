import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The background poller's tick (#289): when it checks, and the order of the
// record → prune → flush → alert steps. Every collaborator is mocked.
const calls: string[] = [];
let settings: { statusChecks: boolean; statusInterval?: number; alerts: object };
let apps: { id: string; interval?: number }[];

vi.mock("./config", () => ({
  readConfigInternal: vi.fn(async () => ({ settings, apps })),
}));
vi.mock("./status-check", () => ({
  CHECK_CONCURRENCY: 4,
  checkSignature: (app: { id: string }) => `sig:${app.id}`,
  checkApp: vi.fn(async (app: { id: string }) => {
    calls.push(`check:${app.id}`);
    if (app.id === "boom") throw new Error("socket hang up");
    return { up: true, status: 200, ms: 5 };
  }),
}));
vi.mock("./status-history", () => ({
  loadHistory: vi.fn(async () => {}),
  lastReadings: vi.fn(() => {
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
  settings = { statusChecks: true, statusInterval: 5, alerts: {} };
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

  it("logs a failed round instead of throwing, and stops before recording", async () => {
    apps = [{ id: "boom" }];
    await expect(tick()).resolves.toBeUndefined();
    expect(calls).not.toContain("record");
    expect(warn).toHaveBeenCalledWith("status poll tick failed", { reason: "socket hang up" });
  });
});
