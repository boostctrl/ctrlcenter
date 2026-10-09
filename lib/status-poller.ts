import { readConfigInternal } from "./config";
import { checkApp, checkSignature, CHECK_CONCURRENCY } from "./status-check";
import {
  loadHistory,
  recordResults,
  flush,
  lastReadings,
  pruneHistory,
} from "./status-history";
import { mapLimit } from "./concurrency";
import { publishRound } from "./status-latest";
import { processAlerts } from "./alerts";
import { log, errorReason } from "./log";
import type { StatusResult } from "./status";

// Background uptime poller. Runs in the (single) standalone Node server process,
// independent of page views, so the /status history accrues even when nobody is
// looking. Started once from instrumentation.ts.

let started = false;
let lastRun = 0;

const TICK_MS = 60_000;
const FIRST_DELAY_MS = 8_000;

// Re-reads config every tick so changing the interval (or toggling status checks)
// takes effect without restarting the timer. Exported for tests.
export async function tick(): Promise<void> {
  try {
    // Recording into a store that hasn't loaded yet would let the next flush
    // overwrite the persisted history, so every tick waits for the load.
    await loadHistory();
    const { settings, apps } = await readConfigInternal();
    if (!settings.statusChecks || apps.length === 0) return;
    const intervalMs = (settings.statusInterval ?? 5) * 60_000;
    if (Date.now() - lastRun < intervalMs) return;
    lastRun = Date.now(); // claim the slot before the awaits to avoid re-entry
    const results: StatusResult[] = await mapLimit(
      apps,
      CHECK_CONCURRENCY,
      async (app) => ({ id: app.id, ...(await checkApp(app)) })
    );
    // Capture the prior per-app state before recording this tick, so alert
    // seeding on first run reflects the previous reading, not the current one.
    const prior = lastReadings(apps.map((a) => a.id));
    recordResults(results, lastRun);
    // /api/status serves this round rather than re-probing every app (#278).
    publishRound({
      at: lastRun,
      results,
      signatures: Object.fromEntries(apps.map((a) => [a.id, checkSignature(a)])),
    });
    // Drop the history of apps that no longer exist, so a deleted app's
    // buckets, outages and readings don't ride along in every flush forever.
    pruneHistory(apps.map((a) => a.id));
    await flush();
    await processAlerts(results, apps, settings.alerts, prior);
  } catch (e) {
    // Best-effort; try again next tick. But leave a trace — a persistently
    // failing config read or history flush would otherwise silently stop the
    // uptime history from accruing with no sign of why.
    log.warn("status poll tick failed", { reason: errorReason(e) });
  }
}

export function startStatusPoller(): void {
  if (started) return;
  started = true;
  void loadHistory();
  setTimeout(() => void tick(), FIRST_DELAY_MS);
  setInterval(() => void tick(), TICK_MS);
}
