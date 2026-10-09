// The background poller's latest check of each app (#278), kept in memory so
// /api/status can serve it instead of probing every app on a second schedule.
// Per app, with its own time: since #292 each app runs on its own interval,
// so a poll tick checks only the apps that are due. Held on globalThis: the
// poller runs in the instrumentation bundle and the route in its own, and lib
// module state forks between them.
import { globalSingleton } from "./singleton";
import type { StatusResult } from "./status";

export type LatestCheck = {
  result: StatusResult;
  // When it was checked (epoch ms).
  at: number;
  // The app's checkSignature at check time, so a result for an app whose URL
  // or check type has since been edited isn't served as current.
  signature: string;
};

const latest = globalSingleton<{ checks: Map<string, LatestCheck> }>(
  "__ctrlcenterStatusLatest",
  () => ({ checks: new Map() })
);

// Record one tick's checks, and forget apps no longer configured.
export function publishChecks(checks: LatestCheck[], keepIds: readonly string[]): void {
  for (const c of checks) latest.checks.set(c.result.id, c);
  const keep = new Set(keepIds);
  for (const id of latest.checks.keys()) if (!keep.has(id)) latest.checks.delete(id);
}

export function latestCheck(id: string): LatestCheck | undefined {
  return latest.checks.get(id);
}

// For tests.
export function clearLatestChecks(): void {
  latest.checks.clear();
}
