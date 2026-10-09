// The background poller's most recent round of checks (#278), kept in memory
// so /api/status can serve it instead of probing every app on a second
// schedule. Held on globalThis: the poller runs in the instrumentation bundle
// and the route in its own, and lib module state forks between them.
import { globalSingleton } from "./singleton";
import type { StatusResult } from "./status";

export type StatusRound = {
  at: number;
  results: StatusResult[];
  // Each app's checkSignature at check time, so a result for an app whose URL
  // or check type has since been edited isn't served as current.
  signatures: Record<string, string>;
};

const latest = globalSingleton<{ round: StatusRound | null }>(
  "__ctrlcenterStatusLatest",
  () => ({ round: null })
);

export function publishRound(round: StatusRound): void {
  latest.round = round;
}

export function latestRound(): StatusRound | null {
  return latest.round;
}
