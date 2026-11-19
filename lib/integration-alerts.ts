// Alerts from the integrations' health (#540): a TrueNAS pool that isn't
// healthy, an alert TrueNAS raises, an app that stops. Each condition is a
// switch on the integration (`alertOn`, the type's SERVICE_META
// alertConditions), off by default. Each problem it finds sends a warning,
// and a cleared warning when it's over, through the alert channels like any
// other alert (dispatchAlerts, lib/alerts.ts).
//
// Read from the Monitor's background sampler (lib/monitor-sampler.ts), so
// alerts add no requests: each minute's snapshot, as the Monitor shows it.
// Only a new, good snapshot is a reading. An integration that can't be
// reached alerts nothing (its app's uptime check covers that) and leaves its
// state as it was, and so does a list a snapshot couldn't read. A problem
// takes as many readings in a row as an outage takes failed checks, and is
// over at the first reading without it. The state is kept in
// alert-state.json, so a restart announces nothing again.
import type { Config } from "./schema";
import type { MonitorEntry, MonitorSnapshot } from "./monitor";
import type { ServiceId, ServiceSnapshotMap } from "./services/registry";
import { alertConditionsOn } from "./services/ids";
import { activeChannels } from "./alert-channels";
import { dispatchAlerts } from "./alerts";
import { loadAlertState, readBook, writeBook } from "./alert-state";
import { siteLink } from "./urls";
import { globalSingleton } from "./singleton";

// What one condition reads of one item in a snapshot: past the condition,
// with what the warning says, or not, with what the clearing says; or "hold"
// for an item between the two (an app deploying), which is no reading
// either way.
export type ItemReading = { bad: boolean; text: string } | "hold";

// What one condition reads in one snapshot: each item it can see, by a key
// that stays the same while the item does (a pool's name, a TrueNAS alert's
// id). `gone` is what the clearing says for an item warned about that's no
// longer there: a TrueNAS alert that went away was resolved. Null when that
// only means the item was removed (a pool exported, an app deleted), which
// drops its warning quietly.
export type ConditionReading = {
  items: Map<string, ItemReading>;
  gone: ((warned: string) => string) | null;
};

// Each type's conditions, by the ids SERVICE_META lists. A reader returns
// null when the snapshot couldn't see that part this time.
type Readers = { [K in ServiceId]?: Record<string, (data: ServiceSnapshotMap[K]) => ConditionReading | null> };

export const CONDITION_READERS: Readers = {
  truenas: {
    pool: (d) => ({
      items: new Map(
        d.pools.map((p): [string, ItemReading] => [
          p.name,
          p.healthy
            ? { bad: false, text: `pool ${p.name} is healthy again` }
            : { bad: true, text: p.status === "ONLINE" ? `pool ${p.name} isn't healthy` : `pool ${p.name} is ${p.status}` },
        ])
      ),
      gone: null,
    }),
    alert: (d) =>
      d.unread?.includes("alerts")
        ? null
        : {
            items: new Map(d.alerts.map((a): [string, ItemReading] => [a.id, { bad: true, text: a.message }])),
            gone: (warned) => `resolved: ${warned}`,
          },
    app: (d) =>
      d.unread?.includes("apps")
        ? null
        : {
            items: new Map(
              d.apps.map((a): [string, ItemReading] => [
                a.name,
                a.running
                  ? { bad: false, text: `app ${a.name} is running again` }
                  : a.state === "STOPPED" || a.state === "CRASHED"
                    ? { bad: true, text: `app ${a.name} ${a.state === "CRASHED" ? "crashed" : "stopped"}` }
                    : "hold",
              ])
            ),
            gone: null,
          },
  },
};

function readCondition(e: MonitorEntry, condition: string): ConditionReading | null {
  const read = (CONDITION_READERS[e.type] as Record<string, (data: unknown) => ConditionReading | null> | undefined)?.[
    condition
  ];
  return read && e.data ? read(e.data) : null;
}

// One problem between readings: whether its warning went out, how many new
// readings in a row have found it (stopping at the confirmations a warning
// needs), and what the last one said, for the clearing of an item that
// goes away.
export type HealthState = { warned: boolean; streak: number; text: string };
export type HealthEvent = { key: string; integration: string; type: "warning" | "cleared"; detail: string };
export type HealthReading = { integration: string; condition: string; reading: ConditionReading };

// The book's key for one item of one condition of one integration.
// Integration and condition ids hold no "|".
export const healthKey = (integration: string, condition: string, item: string) =>
  `${integration}|${condition}|${item}`;

const TEXT_MAX = 300;

// Pure step, alongside evaluateThresholds (lib/widget-alerts.ts): each
// reading here is a new one.
export function evaluateHealth(
  prev: Map<string, HealthState>,
  readings: HealthReading[],
  confirmations: number
): { next: Map<string, HealthState>; events: HealthEvent[] } {
  const need = Math.max(1, Math.floor(confirmations));
  const next = new Map(prev);
  const events: HealthEvent[] = [];
  for (const { integration, condition, reading } of readings) {
    const prefix = healthKey(integration, condition, "");
    for (const [item, r] of reading.items) {
      if (r === "hold") continue;
      const key = prefix + item;
      const cur = next.get(key);
      if (r.bad) {
        const streak = Math.min(need, (cur?.streak ?? 0) + 1);
        const warned = cur?.warned === true || streak >= need;
        if (warned && !cur?.warned) events.push({ key, integration, type: "warning", detail: r.text });
        next.set(key, { warned, streak, text: r.text.slice(0, TEXT_MAX) });
      } else if (cur) {
        if (cur.warned) events.push({ key, integration, type: "cleared", detail: r.text });
        next.delete(key);
      }
    }
    for (const [key, cur] of next) {
      if (!key.startsWith(prefix) || reading.items.has(key.slice(prefix.length))) continue;
      if (cur.warned && reading.gone) events.push({ key, integration, type: "cleared", detail: reading.gone(cur.text) });
      next.delete(key);
    }
  }
  return { next, events };
}

// A problem as alert-state.json holds it.
function isHealthState(v: unknown): v is HealthState {
  const h = v as HealthState | null;
  return (
    !!h &&
    typeof h === "object" &&
    typeof h.warned === "boolean" &&
    typeof h.streak === "number" &&
    Number.isInteger(h.streak) &&
    h.streak >= 0 &&
    typeof h.text === "string"
  );
}

// When each integration's last counted snapshot was taken. Kept in memory
// only: the Monitor's cache starts empty after a restart, so its first
// snapshot then is a new one.
const counted = globalSingleton("__ctrlcenterHealthReadings", () => new Map<string, number>());

// For the tests: forget which snapshots were counted, as a restart would.
export function resetCountedSnapshots(): void {
  counted.clear();
}

// One run of the check, on the snapshot the sampler just read.
export async function checkIntegrationAlerts(
  config: Pick<Config, "settings" | "integrations">,
  snapshot: MonitorSnapshot
): Promise<void> {
  const alerts = config.settings.alerts;
  if (!alerts.enabled || activeChannels(alerts).length === 0) return;
  await loadAlertState();
  const watched = new Map<string, string[]>();
  for (const i of config.integrations) {
    const on = alertConditionsOn(i);
    if (on.length > 0) watched.set(i.id, on);
  }
  // A condition switched off, or an integration removed, takes its problems
  // along, quietly.
  const prev = readBook("health", isHealthState);
  for (const key of prev.keys()) {
    const [id, condition] = key.split("|");
    if (!watched.get(id)?.includes(condition)) prev.delete(key);
  }
  for (const id of counted.keys()) if (!watched.has(id)) counted.delete(id);
  const readings: HealthReading[] = [];
  const entries = new Map<string, MonitorEntry>();
  for (const e of snapshot) {
    const conditions = watched.get(e.id);
    if (!conditions || !e.data || e.error !== null || e.at === null || e.at <= (counted.get(e.id) ?? 0)) continue;
    counted.set(e.id, e.at);
    entries.set(e.id, e);
    for (const condition of conditions) {
      const reading = readCondition(e, condition);
      if (reading) readings.push({ integration: e.id, condition, reading });
    }
  }
  const { next, events } = evaluateHealth(prev, readings, alerts.confirmations);
  writeBook("health", next);
  if (events.length === 0) return;
  const siteUrl = config.settings.siteUrl;
  await dispatchAlerts(
    alerts,
    events.flatMap((ev) => {
      const e = entries.get(ev.integration);
      if (!e) return [];
      return [
        {
          event: { id: ev.key, type: ev.type, detail: ev.detail },
          subject: {
            kind: "integration" as const,
            id: e.id,
            name: e.label,
            url: siteLink(siteUrl, `/admin/monitor/${encodeURIComponent(e.id)}`),
          },
        },
      ];
    })
  );
}
