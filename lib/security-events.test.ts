import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  KEEP_MS,
  MAX_EVENTS,
  listSecurityEvents,
  recordSecurityEvent,
  securityLogPersisted,
} from "./security-events";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrl-audit-"));
  vi.stubEnv("CONFIG_PATH", path.join(dir, "config.yaml"));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const here = { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (test)" };
const there = { ip: "198.51.100.4", userAgent: "curl" };

function forgetStore() {
  const stores = (globalThis as Record<string, unknown>).__ctrlcenterSecurityEvents as Map<string, unknown>;
  stores.delete(path.join(dir, "security-events.jsonl"));
}

describe("security events (#368)", () => {
  it("records events and lists them newest first", async () => {
    const t = Date.now();
    await recordSecurityEvent("signin.ok", here, undefined, t);
    await recordSecurityEvent("password.changed", here, undefined, t + MIN);
    await recordSecurityEvent("action", here, "qbittorrent delete", t + 2 * MIN);
    const events = await listSecurityEvents(50, t + 3 * MIN);
    expect(events.map((e) => e.kind)).toEqual(["action", "password.changed", "signin.ok"]);
    expect(events[0]).toMatchObject({ detail: "qbittorrent delete", ip: here.ip, userAgent: here.userAgent });
  });

  it("folds repeated failures from one address into one entry with a count", async () => {
    const t = Date.now();
    for (let i = 0; i < 4; i++) await recordSecurityEvent("signin.fail", here, undefined, t + i * 1000);
    // Another address, and the same address after the window, start new entries.
    await recordSecurityEvent("signin.fail", there, undefined, t + 5000);
    await recordSecurityEvent("signin.fail", here, undefined, t + 10 * MIN);
    const events = await listSecurityEvents(50, t + 10 * MIN);
    expect(events.map((e) => [e.ip, e.count ?? 1])).toEqual([
      [here.ip, 1],
      [there.ip, 1],
      [here.ip, 4],
    ]);
  });

  it("folds failures from one IPv6 /64 as one source (#392)", async () => {
    const t = Date.now();
    for (let i = 1; i <= 3; i++) {
      await recordSecurityEvent("signin.fail", { ip: `2001:db8:1:2::${i}`, userAgent: "curl" }, undefined, t + i * 1000);
    }
    await recordSecurityEvent("signin.fail", { ip: "2001:db8:1:3::1", userAgent: "curl" }, undefined, t + 5000);
    const events = await listSecurityEvents(50, t + 6000);
    expect(events.map((e) => [e.ip, e.count ?? 1])).toEqual([
      ["2001:db8:1:3::1", 1],
      ["2001:db8:1:2::1", 3],
    ]);
    expect(events[1].addresses).toBeUndefined();
  });

  it("folds a flood of failures from many addresses into one line that counts them (#392)", async () => {
    const t = Date.now();
    // Twenty entries from twenty addresses stand on their own...
    for (let i = 0; i < 20; i++) {
      await recordSecurityEvent("signin.fail", { ip: `203.0.113.${i + 1}`, userAgent: "curl" }, undefined, t + i * 1000);
    }
    expect(await listSecurityEvents(50, t + 20_000)).toHaveLength(20);
    // ...and from then on the run folds into the last one, whatever the address.
    for (let i = 20; i < 40; i++) {
      await recordSecurityEvent("signin.fail", { ip: `198.51.100.${i}`, userAgent: "curl" }, undefined, t + i * 1000);
    }
    const events = await listSecurityEvents(50, t + 40_000);
    expect(events).toHaveLength(20);
    expect(events[0]).toMatchObject({ ip: "203.0.113.20", count: 21, addresses: 21 });
    // Once the window has passed, a failure starts a fresh entry.
    const later = t + 40_000 + 6 * MIN;
    await recordSecurityEvent("signin.fail", { ip: "198.51.100.99", userAgent: "curl" }, undefined, later);
    expect(await listSecurityEvents(50, later)).toHaveLength(21);
  });

  it("flags a sign-in from an address not seen in 30 days", async () => {
    const t = Date.now();
    expect((await recordSecurityEvent("signin.ok", here, undefined, t)).newAddress).toBe(true);
    expect((await recordSecurityEvent("signin.ok", here, undefined, t + DAY)).newAddress).toBe(false);
    expect((await recordSecurityEvent("signin.ok", there, undefined, t + DAY)).newAddress).toBe(true);
    expect((await recordSecurityEvent("signin.ok", here, undefined, t + 32 * DAY)).newAddress).toBe(true);
  });

  it("persists across a restart, with the file private", async () => {
    const t = Date.now();
    await recordSecurityEvent("totp.enabled", here, undefined, t);
    const file = path.join(dir, "security-events.jsonl");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
    forgetStore();
    expect((await listSecurityEvents(50, t)).map((e) => e.kind)).toEqual(["totp.enabled"]);
    expect(await securityLogPersisted()).toBe(true);
  });

  it("caps the log and drops entries older than the retention", async () => {
    const t = Date.now();
    for (let i = 0; i < MAX_EVENTS + 5; i++) await recordSecurityEvent("action", here, String(i), t + i);
    expect((await listSecurityEvents(MAX_EVENTS + 10, t + MAX_EVENTS)).length).toBe(MAX_EVENTS);
    await recordSecurityEvent("signout", here, undefined, t + KEEP_MS + DAY);
    const listed = await listSecurityEvents(50, t + KEEP_MS + DAY);
    expect(listed.map((e) => e.kind)).toEqual(["signout"]);
  });

  it("skips a torn line and keeps the rest", async () => {
    const t = Date.now();
    fs.writeFileSync(
      path.join(dir, "security-events.jsonl"),
      JSON.stringify({ at: t, kind: "signin.ok", ip: "1.2.3.4", userAgent: "x" }) + "\n{torn",
      "utf8"
    );
    expect((await listSecurityEvents(50, t)).map((e) => e.ip)).toEqual(["1.2.3.4"]);
  });

  it("keeps working in memory when the volume can't hold the file", async () => {
    vi.stubEnv("CONFIG_PATH", "/dev/null/config.yaml");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await recordSecurityEvent("signin.ok", here);
    expect((await listSecurityEvents()).length).toBeGreaterThanOrEqual(1);
    expect(await securityLogPersisted()).toBe(false);
    warn.mockRestore();
  });
});
