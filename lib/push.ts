// Push / heartbeat checks (#294): instead of CtrlCenter reaching out, a cron
// job or backup script calls the app's secret URL (/api/push/<token>) when it
// runs; the app is up while the last ping is recent. Pings are kept in memory
// on globalThis (the route and the poller live in different bundles).
import { randomBytes } from "node:crypto";
import { globalSingleton } from "./singleton";

const state = globalSingleton("__ctrlcenterPush", () => ({
  // When this process started: after a restart nothing has pinged yet, so
  // every push app gets one full grace window rather than reading as down.
  startedAt: Date.now(),
  last: new Map<string, number>(),
}));

export function recordPush(appId: string, at = Date.now()): void {
  state.last.set(appId, at);
}

// The last ping for an app, or the process start when none arrived since.
export function lastPushAt(appId: string): number {
  return state.last.get(appId) ?? state.startedAt;
}

// A fresh push token: 144 random bits, URL-safe.
export function newPushToken(): string {
  return randomBytes(18).toString("base64url");
}

// For tests.
export function resetPushState(startedAt = Date.now()): void {
  state.startedAt = startedAt;
  state.last.clear();
}
