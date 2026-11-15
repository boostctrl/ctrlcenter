import { readConfigInternal } from "./config";
import { getMonitorSnapshot } from "./monitor";
import { forgetHistory, loadHistory } from "./monitor-history";
import { log, errorReason } from "./log";

// The Monitor's background sampler (#530): a snapshot of every connected
// integration once a minute, whether or not anyone has the Monitor open, so
// its charts (lib/monitor-history.ts) have a reading for every minute. It
// reads through the same cache the pages do, so an open page adds no extra
// requests to a service. Started once from instrumentation-node.ts.

const TICK_MS = 60_000;
const FIRST_DELAY_MS = 15_000;

let started = false;
let running = false;

// Exported for the tests.
export async function sample(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await loadHistory();
    const { integrations } = await readConfigInternal();
    // An integration that was removed takes its history with it.
    const ids = new Set(integrations.map((i) => i.id));
    forgetHistory((id) => ids.has(id));
    if (integrations.length > 0) await getMonitorSnapshot(integrations, false);
  } catch (e) {
    log.warn(`monitor sampler: ${errorReason(e)}`);
  } finally {
    running = false;
  }
}

export function startMonitorSampler(): void {
  if (started) return;
  started = true;
  setTimeout(() => void sample(), FIRST_DELAY_MS).unref?.();
  setInterval(() => void sample(), TICK_MS).unref?.();
}
