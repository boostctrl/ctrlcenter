// Alerts from the API widgets' thresholds (#539): a widget with its alert
// switch on sends a warning when its headline number goes past warn, a down
// alert past critical, and a recovery when it comes back, through the alert
// channels like any other alert (dispatchAlerts, lib/alerts.ts).
//
// A loop decides once a minute, on the server, whether or not a page is
// open. It reads through the widget's own cache (getApiHeadline), so it adds
// no fetches: an open page and the check share one fetch at the widget's
// refresh rate. Confirmations count new readings, not loop runs, so one
// cached value can't confirm a crossing by being read three times. A failed
// fetch leaves the state as it was. Started once from instrumentation-node.ts.
import { readConfigInternal } from "./config";
import { activeChannels, alertingWidgets, widgetAlertName, type AlertSubject } from "./alert-channels";
import { dispatchAlerts, type AlertEvent, type AlertEventType } from "./alerts";
import { loadAlertState, readBook, writeBook } from "./alert-state";
import { apiTone, formatApiValue, getApiHeadline, type ApiHeadline, type ApiTone } from "./api-widget";
import { boardName, type Board, type InstanceOf } from "./schema";
import { instanceLabels } from "./widgets/labels";
import { siteLink } from "./urls";
import { globalSingleton } from "./singleton";
import { log, errorReason } from "./log";

type ApiWidget = InstanceOf<"api">;

const TICK_MS = 60_000;
const FIRST_DELAY_MS = 20_000;

const RANK: Record<ApiTone, number> = { ok: 0, warn: 1, critical: 2 };

// A widget's state between readings: the level last announced, and how many
// new readings in a row have been past warn and past critical. The streaks
// stop counting at the confirmations a crossing needs, so a widget that
// stays past a threshold leaves the saved state alone.
export type ThresholdState = { level: ApiTone; warnStreak: number; criticalStreak: number };
export type ThresholdReading = { id: string; level: ApiTone };

// Pure step, alongside evaluateTransitions (lib/alerts.ts): each reading
// here is a new one. Going past a threshold takes `confirmations` readings in
// a row past it, as an app's outage takes that many failed checks; coming
// back takes one, as an app's recovery does. Past warn is a warning, past
// critical a down alert (from warn too: the warning is part of it), back
// from critical a recovery (still past warn or not), and back from warn
// alone a cleared warning. A widget at rest (no level, no streak) has no
// entry.
export function evaluateThresholds(
  prev: Map<string, ThresholdState>,
  readings: ThresholdReading[],
  confirmations: number
): { next: Map<string, ThresholdState>; events: AlertEvent[] } {
  const need = Math.max(1, Math.floor(confirmations));
  const next = new Map(prev);
  const events: AlertEvent[] = [];
  for (const r of readings) {
    const cur = next.get(r.id) ?? { level: "ok", warnStreak: 0, criticalStreak: 0 };
    const warnStreak = r.level === "ok" ? 0 : Math.min(need, cur.warnStreak + 1);
    const criticalStreak = r.level === "critical" ? Math.min(need, cur.criticalStreak + 1) : 0;
    let level: ApiTone;
    if (RANK[r.level] < RANK[cur.level]) {
      level = r.level;
    } else {
      const confirmed: ApiTone = criticalStreak >= need ? "critical" : warnStreak >= need ? "warn" : "ok";
      level = RANK[confirmed] > RANK[cur.level] ? confirmed : cur.level;
    }
    if (RANK[level] > RANK[cur.level]) {
      events.push({ id: r.id, type: level === "critical" ? "down" : "warning" });
    } else if (RANK[level] < RANK[cur.level]) {
      events.push({ id: r.id, type: cur.level === "critical" ? "up" : "cleared" });
    }
    if (level === "ok" && warnStreak === 0 && criticalStreak === 0) next.delete(r.id);
    else next.set(r.id, { level, warnStreak, criticalStreak });
  }
  return { next, events };
}

// Where the number stands, for the event's detail: "92 % (critical ≥ 90)"
// going past, "75 %, back under 90" coming back. A threshold removed while
// it was crossed leaves just the number.
export function thresholdDetail(
  type: AlertEventType,
  reading: Pick<ApiHeadline, "text">,
  t: ApiWidget["thresholds"]
): string {
  const op = t.direction === "above" ? "≥" : "≤";
  const back = t.direction === "above" ? "under" : "above";
  const past = (name: string, n: number | null) =>
    n === null ? reading.text : `${reading.text} (${name} ${op} ${formatApiValue(n)})`;
  const under = (n: number | null) => (n === null ? reading.text : `${reading.text}, back ${back} ${formatApiValue(n)}`);
  switch (type) {
    case "down":
      return past("critical", t.critical);
    case "warning":
      return past("warn", t.warn);
    case "up":
      return under(t.critical);
    case "cleared":
    default:
      return under(t.warn);
  }
}

// What the alert is about: the widget by its alert name
// (widgetAlertName), on the board it shows on, linked there when the site
// address is set. A widget on several boards is named by the first that
// shows it, one on none by itself.
export function widgetSubject(
  w: ApiWidget,
  ctx: { boards: readonly Board[]; labels: Record<string, string>; siteUrl: string }
): AlertSubject {
  const name = widgetAlertName(w, ctx.labels);
  const placed = ctx.boards.filter((b) => b.layout.sections.some((s) => s.widget === w.id));
  const board = placed.find((b) => b.layout.sections.some((s) => s.widget === w.id && !s.hidden)) ?? placed[0];
  if (!board) return { kind: "widget", id: w.id, name, url: "" };
  const path = board.id === ctx.boards[0]?.id ? "/" : `/b/${encodeURIComponent(board.id)}`;
  return { kind: "widget", id: w.id, name: `${name} on ${boardName(board)}`, url: siteLink(ctx.siteUrl, path) };
}

// A threshold entry as alert-state.json holds it.
const isStreak = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
function isThresholdState(v: unknown): v is ThresholdState {
  const t = v as ThresholdState | null;
  return (
    !!t &&
    typeof t === "object" &&
    (t.level === "ok" || t.level === "warn" || t.level === "critical") &&
    isStreak(t.warnStreak) &&
    isStreak(t.criticalStreak)
  );
}

// When each widget's last counted reading was fetched. Kept in memory only:
// the cache it compares against starts empty after a restart, so the first
// reading then is a new one.
const counted = globalSingleton("__ctrlcenterThresholdReadings", () => new Map<string, number>());

// For the tests: forget which readings were counted, as a restart would.
export function resetCountedReadings(): void {
  counted.clear();
}

// One run of the check. Exported for the tests.
export async function checkWidgetAlerts(): Promise<void> {
  const { settings, boards, widgets } = await readConfigInternal();
  const config = settings.alerts;
  if (!config.enabled || activeChannels(config).length === 0) return;
  await loadAlertState();
  const watched = alertingWidgets(widgets);
  const ids = new Set(watched.map((w) => w.id));
  // A widget no longer watched takes its state along, quietly.
  const prev = readBook("thresholds", isThresholdState);
  for (const id of prev.keys()) if (!ids.has(id)) prev.delete(id);
  for (const id of counted.keys()) if (!ids.has(id)) counted.delete(id);
  const read = await Promise.all(watched.map(async (w) => ({ w, headline: await getApiHeadline(w) })));
  const fresh = read.filter(
    (r): r is { w: ApiWidget; headline: ApiHeadline } =>
      r.headline !== null && r.headline.at > (counted.get(r.w.id) ?? 0)
  );
  for (const { w, headline } of fresh) counted.set(w.id, headline.at);
  const { next, events } = evaluateThresholds(
    prev,
    fresh.map(({ w, headline }) => ({ id: w.id, level: apiTone(headline.value, w.thresholds) })),
    config.confirmations
  );
  writeBook("thresholds", next);
  if (events.length === 0) return;
  const byId = new Map(fresh.map((r) => [r.w.id, r]));
  const ctx = { boards, labels: instanceLabels(widgets), siteUrl: settings.siteUrl };
  await dispatchAlerts(
    config,
    events.flatMap((event) => {
      const r = byId.get(event.id);
      if (!r) return [];
      return [
        {
          event: { ...event, detail: thresholdDetail(event.type, r.headline, r.w.thresholds) },
          subject: widgetSubject(r.w, ctx),
        },
      ];
    })
  );
}

let started = false;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await checkWidgetAlerts();
  } catch (e) {
    log.warn(`widget alerts: ${errorReason(e)}`);
  } finally {
    running = false;
  }
}

export function startWidgetAlerts(): void {
  if (started) return;
  started = true;
  setTimeout(() => void tick(), FIRST_DELAY_MS).unref?.();
  setInterval(() => void tick(), TICK_MS).unref?.();
}
