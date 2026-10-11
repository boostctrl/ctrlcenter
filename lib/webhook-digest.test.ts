import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { holdForDigest, pendingWebhookDigests, resetWebhookDigest } from "./webhook-digest";
import { keyForLog, parseArrWebhook } from "./webhooks";
import { log } from "./log";

// The burst store (#346) on fake timers: when a group goes out, what it
// holds, and that nothing leaks between tests.
const MIN = 60_000;

// One Sonarr import event for an episode of series `sid`.
const imported = (ep: number, sid = 1) =>
  parseArrWebhook("sonarr", {
    eventType: "Download",
    series: { id: sid, title: sid === 1 ? "The Bear" : "Silo" },
    episodes: [{ id: sid * 1000 + ep, seasonNumber: 4, episodeNumber: ep, title: `Ep ${ep}` }],
    episodeFile: { quality: "WEBDL-1080p", size: 1024 ** 3 },
  })!;

const sent = () => vi.fn<(c: unknown) => Promise<void>>().mockResolvedValue(undefined);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T20:00:00Z"));
});

afterEach(() => {
  resetWebhookDigest();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("holdForDigest", () => {
  it("sends one merged notification once the burst has been quiet for a window", async () => {
    const send = sent();
    for (let e = 1; e <= 8; e += 1) {
      holdForDigest(imported(e), { windowMs: MIN, send });
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(pendingWebhookDigests()).toEqual([{ key: "sonarr||Download|1", count: 8 }]);
    // The window slides: a minute after the LAST event, not the first.
    await vi.advanceTimersByTimeAsync(MIN - 5_000 - 1);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      title: "Sonarr imported 8 episodes of The Bear (S04E01-E08)",
    });
    expect(pendingWebhookDigests()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("caps a burst that never goes quiet at five windows, ten minutes at most", async () => {
    const send = sent();
    // A trickle every 30 s with a 60 s window: the slide alone would never
    // fire; the cap fires at 5 × 60 s from the first event.
    for (let t = 0; t < 7 * MIN; t += 30_000) {
      holdForDigest(imported(t / 30_000 + 1), { windowMs: MIN, send });
      expect(send).toHaveBeenCalledTimes(t + 30_000 > 5 * MIN ? 1 : 0);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ title: expect.stringMatching(/^Sonarr imported 10 episodes/) });
    resetWebhookDigest();
    // A 200 s window would allow 1000 s; ten minutes wins.
    const slow = sent();
    for (let t = 0; t < 12 * MIN; t += 100_000) {
      holdForDigest(imported(t / 100_000 + 1, 2), { windowMs: 200_000, send: slow });
      expect(slow).toHaveBeenCalledTimes(t + 100_000 > 10 * MIN ? 1 : 0);
      await vi.advanceTimersByTimeAsync(100_000);
    }
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it("keeps separate keys apart and sends each", async () => {
    const send = sent();
    holdForDigest(imported(1, 1), { windowMs: MIN, send });
    holdForDigest(imported(1, 2), { windowMs: MIN, send });
    holdForDigest(imported(2, 1), { windowMs: MIN, send });
    expect(pendingWebhookDigests()).toEqual([
      { key: "sonarr||Download|1", count: 2 },
      { key: "sonarr||Download|2", count: 1 },
    ]);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(send).toHaveBeenCalledTimes(2);
    const titles = send.mock.calls.map((c) => (c[0] as { title: string }).title).sort();
    expect(titles).toEqual(["Sonarr imported 2 episodes of The Bear (S04E01-E02)", "Sonarr imported: Silo S04E01"]);
  });

  it("sends a group of one event unchanged, only later", async () => {
    const send = sent();
    const only = imported(3);
    holdForDigest(only, { windowMs: MIN, send });
    await vi.advanceTimersByTimeAsync(MIN);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(only);
  });

  it("keeps a hundred items, counts the rest, and counts a resent item once", async () => {
    const send = sent();
    for (let e = 1; e <= 101; e += 1) holdForDigest(imported(e), { windowMs: MIN, send });
    holdForDigest(imported(50), { windowMs: MIN, send });
    expect(pendingWebhookDigests()).toEqual([{ key: "sonarr||Download|1", count: 101 }]);
    await vi.advanceTimersByTimeAsync(MIN);
    const merged = send.mock.calls[0][0] as { title: string; body: string };
    expect(merged.title).toMatch(/^Sonarr imported 101 episodes of The Bear \(S04E01-E100\)$/);
    expect(merged.body.endsWith("\nand 93 more")).toBe(true);
  });

  it("holds 64 groups at most: a 65th key is not held, the rest still flush, then a key is held again", async () => {
    vi.spyOn(log, "info").mockImplementation(() => undefined);
    const send = sent();
    // One series per event: a new key each time, up to the cap.
    for (let sid = 1; sid <= 64; sid += 1) expect(holdForDigest(imported(1, sid), { windowMs: MIN, send })).toBe(true);
    expect(pendingWebhookDigests()).toHaveLength(64);
    expect(holdForDigest(imported(1, 65), { windowMs: MIN, send })).toBe(false);
    expect(pendingWebhookDigests()).toHaveLength(64);
    expect(pendingWebhookDigests().some((g) => g.key === "sonarr||Download|65")).toBe(false);
    expect(send).not.toHaveBeenCalled();
    // A key already pending still takes its event.
    expect(holdForDigest(imported(2, 64), { windowMs: MIN, send })).toBe(true);
    expect(pendingWebhookDigests().find((g) => g.key === "sonarr||Download|64")?.count).toBe(2);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(send).toHaveBeenCalledTimes(64);
    expect(pendingWebhookDigests()).toEqual([]);
    expect(holdForDigest(imported(1, 65), { windowMs: MIN, send })).toBe(true);
    expect(pendingWebhookDigests()).toEqual([{ key: "sonarr||Download|65", count: 1 }]);
  });

  it("opens a fresh group for an event arriving after the send", async () => {
    const send = sent();
    holdForDigest(imported(1), { windowMs: MIN, send });
    await vi.advanceTimersByTimeAsync(MIN);
    expect(send).toHaveBeenCalledTimes(1);
    holdForDigest(imported(2), { windowMs: MIN, send });
    holdForDigest(imported(3), { windowMs: MIN, send });
    expect(pendingWebhookDigests()).toEqual([{ key: "sonarr||Download|1", count: 2 }]);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toMatchObject({ title: "Sonarr imported 2 episodes of The Bear (S04E02-E03)" });
  });

  it("logs a failed send once and forgets the group", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const send = vi.fn<(c: unknown) => Promise<void>>().mockRejectedValue(new Error("SMTP down"));
    holdForDigest(imported(1), { windowMs: MIN, send });
    holdForDigest(imported(2), { windowMs: MIN, send });
    await vi.advanceTimersByTimeAsync(MIN);
    expect(send).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("webhook digest failed", { key: "sonarr||Download|1", reason: "SMTP down" });
    expect(pendingWebhookDigests()).toEqual([]);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("logs a short, clean form of the key, never the raw one", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    // A key whose every segment the sender sized — instance, event type and
    // a title standing in for a series id — each already cut at parse time,
    // and together still longer than a log line should carry.
    const hostile = parseArrWebhook("sonarr", {
      eventType: "Download\u001b[31m\u0007" + "x".repeat(200_000),
      instanceName: "I".repeat(500),
      series: { title: "T".repeat(500) },
      episodes: [{ id: 1, seasonNumber: 1, episodeNumber: 1 }],
    })!;
    const key = hostile.digest!.key;
    expect(key.length).toBeGreaterThan(80);
    holdForDigest(hostile, { windowMs: MIN, send: sent() });
    await vi.advanceTimersByTimeAsync(MIN);
    expect(info).toHaveBeenCalledWith("webhook digest relayed", { key: keyForLog(key), events: 1, items: 1 });
    const failing = vi.fn<(c: unknown) => Promise<void>>().mockRejectedValue(new Error("SMTP down"));
    holdForDigest(hostile, { windowMs: MIN, send: failing });
    await vi.advanceTimersByTimeAsync(MIN);
    expect(warn).toHaveBeenCalledWith("webhook digest failed", { key: keyForLog(key), reason: "SMTP down" });
    for (const call of [...info.mock.calls, ...warn.mock.calls]) {
      const logged = (call[1] as { key: string }).key;
      expect(logged).not.toBe(key);
      expect(logged.length).toBeLessThanOrEqual(80);
      expect(logged).not.toMatch(/\p{Cc}/u);
      expect(key.startsWith(logged.slice(0, -1))).toBe(true);
    }
    // The helper itself: controls and whitespace runs become one space.
    expect(keyForLog("a\u001b[31m\u0007 \r\n b")).toBe("a [31m b");
    expect(keyForLog("sonarr||Download|1")).toBe("sonarr||Download|1");
  });

  it("ignores an event with no digest", () => {
    const send = sent();
    const test = parseArrWebhook("sonarr", { eventType: "Test" })!;
    expect(holdForDigest(test, { windowMs: MIN, send })).toBe(false);
    expect(pendingWebhookDigests()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resets to nothing pending and no timers", async () => {
    const send = sent();
    holdForDigest(imported(1, 1), { windowMs: MIN, send });
    holdForDigest(imported(1, 2), { windowMs: MIN, send });
    expect(vi.getTimerCount()).toBe(2);
    resetWebhookDigest();
    expect(pendingWebhookDigests()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(send).not.toHaveBeenCalled();
  });
});
