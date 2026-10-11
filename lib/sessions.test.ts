import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ABSOLUTE_MAX_AGE_MS,
  DEFAULT_IDLE_HOURS,
  createSession,
  getIdleHours,
  getSession,
  listSessions,
  revokeSession,
  revokeSessions,
  sessionsPersisted,
  setIdleHours,
  touchSession,
} from "./sessions";

// Each test gets its own scratch volume, so the process-wide store (keyed
// by file path) starts empty.
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrl-sessions-"));
  vi.stubEnv("CONFIG_PATH", path.join(dir, "config.yaml"));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const HOUR = 60 * 60 * 1000;
const meta = { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (test)" };

// Drop the in-memory store so the next call re-reads the file, as a fresh
// process would.
function forgetStore() {
  const stores = (globalThis as Record<string, unknown>).__ctrlcenterSessions as Map<string, unknown>;
  stores.delete(path.join(dir, "sessions.json"));
}

describe("session records (#365)", () => {
  it("creates a session that can be looked up and touched", async () => {
    const id = await createSession(meta, 1_000);
    expect(id.length).toBeGreaterThanOrEqual(20);
    const s = await getSession(id, 1_000);
    expect(s).toMatchObject({ id, createdAt: 1_000, lastSeenAt: 1_000, ...meta });
    expect(await touchSession(id, 2_000)).not.toBeNull();
  });

  it("gives every session a distinct id", async () => {
    const a = await createSession(meta);
    const b = await createSession(meta);
    expect(a).not.toBe(b);
    expect((await listSessions()).map((s) => s.id).sort()).toEqual([a, b].sort());
  });

  it("persists sessions and the idle timeout across a restart", async () => {
    const now = Date.now();
    const id = await createSession(meta, now);
    await setIdleHours(6);
    const file = path.join(dir, "sessions.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    forgetStore();
    expect(await getSession(id, now + 1_000)).toMatchObject({ id, ip: meta.ip });
    expect(await getIdleHours()).toBe(6);
    expect(await sessionsPersisted()).toBe(true);
  });

  it("ends a revoked session at once", async () => {
    const id = await createSession(meta);
    expect(await revokeSession(id)).toBe(true);
    expect(await touchSession(id)).toBeNull();
    expect(await revokeSession(id)).toBe(false);
    forgetStore();
    expect(await getSession(id)).toBeNull();
  });

  it("ends a session idle past the timeout, and keeps one that stays active", async () => {
    const idleMs = DEFAULT_IDLE_HOURS * HOUR;
    const idle = await createSession(meta, 0);
    const active = await createSession(meta, 0);
    // Seen halfway through the window: the clock restarts from there.
    expect(await touchSession(active, idleMs / 2)).not.toBeNull();
    expect(await touchSession(idle, idleMs + 1)).toBeNull();
    expect(await touchSession(active, idleMs + 1)).not.toBeNull();
    expect((await listSessions(idleMs + 1)).map((s) => s.id)).toEqual([active]);
  });

  it("ends a session after the absolute lifetime however active", async () => {
    const id = await createSession(meta, 0);
    // Used every 12 hours, so the idle timeout never trips.
    for (let t = 12 * HOUR; t < ABSOLUTE_MAX_AGE_MS; t += 12 * HOUR) {
      expect(await touchSession(id, t)).not.toBeNull();
    }
    expect(await touchSession(id, ABSOLUTE_MAX_AGE_MS + 1)).toBeNull();
  });

  it("applies a shorter idle timeout to sessions already idle past it", async () => {
    const now = Date.now();
    const stale = await createSession(meta, now - 3 * HOUR);
    const fresh = await createSession(meta, now);
    expect(await setIdleHours(2)).toBe(2);
    expect((await listSessions(now)).map((s) => s.id)).toEqual([fresh]);
    expect(await getSession(stale, now)).toBeNull();
  });

  it("clamps the idle timeout to its bounds", async () => {
    expect(await setIdleHours(0)).toBe(1);
    expect(await setIdleHours(10_000)).toBe(24 * 7);
    expect(await setIdleHours(Number.NaN)).toBe(DEFAULT_IDLE_HOURS);
  });

  it("signs out everywhere else, keeping the caller's session", async () => {
    const mine = await createSession(meta);
    await createSession(meta);
    await createSession(meta);
    expect(await revokeSessions(mine)).toBe(2);
    expect((await listSessions()).map((s) => s.id)).toEqual([mine]);
    // And everywhere, including the caller's (a password change).
    expect(await revokeSessions()).toBe(1);
    expect(await listSessions()).toEqual([]);
  });

  it("lists the most recently seen session first", async () => {
    const older = await createSession(meta, 1_000);
    const newer = await createSession(meta, 2_000);
    expect((await listSessions(3_000)).map((s) => s.id)).toEqual([newer, older]);
    await touchSession(older, 200_000);
    expect((await listSessions(200_000)).map((s) => s.id)).toEqual([older, newer]);
  });

  it("bounds the stored user agent", async () => {
    const id = await createSession({ ip: null, userAgent: "x".repeat(1_000) });
    expect((await getSession(id))?.userAgent.length).toBe(300);
  });

  it("keeps working in memory when the volume can't hold the file", async () => {
    vi.stubEnv("CONFIG_PATH", "/dev/null/config.yaml");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const id = await createSession(meta);
    expect(await touchSession(id)).not.toBeNull();
    expect(await sessionsPersisted()).toBe(false);
    // One warning that the file can't be read and one that it can't be
    // written, for the store — not one per write.
    const after = warn.mock.calls.length;
    expect(after).toBeLessThanOrEqual(2);
    await createSession(meta);
    await createSession(meta);
    expect(warn).toHaveBeenCalledTimes(after);
    warn.mockRestore();
  });

  it("starts empty from an unparseable file rather than failing", async () => {
    fs.writeFileSync(path.join(dir, "sessions.json"), "{not json", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await listSessions()).toEqual([]);
    const id = await createSession(meta);
    expect(await getSession(id)).not.toBeNull();
    warn.mockRestore();
  });
});
