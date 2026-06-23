import { readConfig } from "./config";
import { checkApp } from "./status-check";
import { loadHistory, recordResults, flush } from "./status-history";
import type { StatusResult } from "./status";

// Background uptime poller. Runs in the (single) standalone Node server process,
// independent of page views, so the /status history accrues even when nobody is
// looking. Started once from instrumentation.ts.

let started = false;
let lastRun = 0;

const TICK_MS = 60_000;
const FIRST_DELAY_MS = 8_000;

// Re-reads config every tick so changing the interval (or toggling status checks)
// takes effect without restarting the timer.
async function tick(): Promise<void> {
  try {
    const { settings, apps } = await readConfig();
    if (!settings.statusChecks || apps.length === 0) return;
    const intervalMs = (settings.statusInterval ?? 5) * 60_000;
    if (Date.now() - lastRun < intervalMs) return;
    lastRun = Date.now(); // claim the slot before the awaits to avoid re-entry
    const results: StatusResult[] = await Promise.all(
      apps.map(async (app) => ({ id: app.id, ...(await checkApp(app)) }))
    );
    recordResults(results, lastRun);
    await flush();
  } catch {
    // Best-effort; try again next tick.
  }
}

export function startStatusPoller(): void {
  if (started) return;
  started = true;
  void loadHistory();
  setTimeout(() => void tick(), FIRST_DELAY_MS);
  setInterval(() => void tick(), TICK_MS);
}
