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
import { publishChecks } from "./status-latest";
import { monitoredApps } from "./schema";
import { processAlerts } from "./alerts";
import { maintenanceApps } from "./status-announcements";
import { log, errorReason } from "./log";
import type { StatusResult } from "./status";

// Background uptime poller. Runs in the (single) standalone Node server process,
// independent of page views, so the /status history accrues even when nobody is
// looking. Started once from instrumentation.ts.

let started = false;
// When each app was last checked (epoch ms). Each app runs on its own interval
// (#292), so a tick checks only the apps that are due; after a restart every
// app is due at once.
const lastChecked = new Map<string, number>();

const TICK_MS = 60_000;
const FIRST_DELAY_MS = 8_000;

// Re-reads config every tick so changing an interval (or toggling status
// checks) takes effect without restarting the timer. Exported for tests.
export async function tick(): Promise<void> {
  try {
    // Recording into a store that hasn't loaded yet would let the next flush
    // overwrite the persisted history, so every tick waits for the load.
    await loadHistory();
    const { settings, apps: allApps } = await readConfigInternal();
    // Only monitored apps are checked (#296); every configured app keeps its
    // history (see pruneHistory below), so switching one back on resumes it.
    const apps = monitoredApps(allApps);
    if (!settings.statusChecks || apps.length === 0) return;
    const globalMinutes = settings.statusInterval ?? 5;
    const now = Date.now();
    // An app is due once its interval (its own, else the global one) has
    // passed since its last check. A tick is a minute, the smallest interval.
    const due = apps.filter(
      (a) => now - (lastChecked.get(a.id) ?? 0) >= (a.interval ?? globalMinutes) * 60_000
    );
    if (due.length === 0) return;
    // Claim the slots before the awaits, so a slow round can't be re-entered.
    for (const a of due) lastChecked.set(a.id, now);
    const results: StatusResult[] = await mapLimit(
      due,
      CHECK_CONCURRENCY,
      async (app) => ({ id: app.id, ...(await checkApp(app, { intervalMinutes: globalMinutes })) })
    );
    // Capture the prior per-app state before recording this tick, so alert
    // seeding on first run reflects the previous reading, not the current one.
    const prior = lastReadings(apps.map((a) => a.id));
    // Apps under an active maintenance window (#293): recorded as maintenance
    // and left out of alerting until the window ends.
    const maintenance = maintenanceApps(settings.statusAnnouncements, now);
    recordResults(results, now, maintenance);
    // /api/status serves these rather than re-probing every app (#278).
    const byId = new Map(due.map((a) => [a.id, a]));
    publishChecks(
      results.map((result) => ({
        result,
        at: now,
        signature: checkSignature(byId.get(result.id)!),
      })),
      apps.map((a) => a.id)
    );
    // Drop the history of apps that no longer exist, so a deleted app's
    // buckets, outages and readings don't ride along forever.
    const ids = new Set(apps.map((a) => a.id));
    for (const id of lastChecked.keys()) if (!ids.has(id)) lastChecked.delete(id);
    pruneHistory(allApps.map((a) => a.id));
    await flush();
    // Held apps skip alerting entirely rather than having their alerts
    // dropped: their alert state stays as it was, so one still down when the
    // window ends alerts then.
    await processAlerts(
      results.filter((r) => !maintenance.has(r.id)),
      apps,
      settings.alerts,
      prior
    );
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
