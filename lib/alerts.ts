import type { AlertConfig, AlertType } from "./schema";

// Outbound uptime alerting. The background poller (lib/status-poller.ts) feeds
// each tick's results through here; we detect down/recovery transitions and POST
// a notification to the configured webhook. The transition logic and payload
// shaping are pure (unit-tested); only sendAlert/processAlerts do IO.

export type AlertEventType = "down" | "up";
export type AlertEvent = { id: string; type: AlertEventType };

// Per-app state carried between ticks. `confirmed` is the last state we've
// committed to (and alerted on); `downStreak` counts consecutive failed polls so
// a single blip doesn't trip the `confirmations` threshold.
export type AppAlertState = { confirmed: "up" | "down" | null; downStreak: number };

// Pure transition step: given the prior per-app state and this tick's up/down
// results, return the next state and the alerts to fire. An app is declared
// "down" only after `confirmations` consecutive failures; recovery fires when a
// confirmed-down app reads up again (when notifyOnRecovery). Initial state
// (`confirmed: null`) never fires a recovery — only a real down→up does.
export function evaluateTransitions(
  prev: Map<string, AppAlertState>,
  results: { id: string; up: boolean }[],
  opts: { confirmations: number; notifyOnRecovery: boolean }
): { next: Map<string, AppAlertState>; events: AlertEvent[] } {
  const confirmations = Math.max(1, Math.floor(opts.confirmations));
  const next = new Map(prev);
  const events: AlertEvent[] = [];
  for (const r of results) {
    const cur = next.get(r.id) ?? { confirmed: null, downStreak: 0 };
    let confirmed = cur.confirmed;
    let downStreak = cur.downStreak;
    if (r.up) {
      downStreak = 0;
      if (confirmed === "down" && opts.notifyOnRecovery) {
        events.push({ id: r.id, type: "up" });
      }
      confirmed = "up";
    } else {
      downStreak += 1;
      if (confirmed !== "down" && downStreak >= confirmations) {
        events.push({ id: r.id, type: "down" });
        confirmed = "down";
      }
    }
    next.set(r.id, { confirmed, downStreak });
  }
  return { next, events };
}

export type AlertApp = { name: string; url: string };
export type AlertRequest = { url: string; init: RequestInit };

// Shape one alert event into a webhook request for the chosen channel. Discord,
// Slack and ntfy each want a specific body/headers; "generic" posts a plain JSON
// envelope for a user's own handler. `at` is passed in so this stays pure.
export function buildAlertRequest(
  type: AlertType,
  webhookUrl: string,
  event: AlertEvent,
  app: AlertApp,
  at: number
): AlertRequest {
  const down = event.type === "down";
  const title = down ? `${app.name} is down` : `${app.name} recovered`;
  const text = `${down ? "🔴" : "🟢"} ${title}`;
  switch (type) {
    case "discord":
      return jsonReq(webhookUrl, { content: app.url ? `${text}\n${app.url}` : text });
    case "slack":
      return jsonReq(webhookUrl, { text: app.url ? `${text}\n${app.url}` : text });
    case "ntfy": {
      // The Title header is latin-1 only, so a non-ASCII service name would make
      // fetch throw and the alert silently drop. Send Title only when it's safe;
      // the full message (emoji and all) always rides in the UTF-8 body.
      const asciiTitle = /^[\x20-\x7E]*$/.test(title) ? title : undefined;
      return {
        url: webhookUrl,
        init: {
          method: "POST",
          headers: {
            ...(asciiTitle ? { Title: asciiTitle } : {}),
            Priority: down ? "high" : "default",
            Tags: down ? "red_circle" : "green_circle",
          },
          body: app.url ? `${text}\n${app.url}` : text,
        },
      };
    }
    case "generic":
    default:
      return jsonReq(webhookUrl, {
        service: app.name,
        url: app.url,
        status: event.type,
        message: text,
        at: new Date(at).toISOString(),
      });
  }
}

function jsonReq(url: string, payload: unknown): AlertRequest {
  return {
    url,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  };
}

const ALERT_TIMEOUT_MS = 5000;

// Fire one webhook, best-effort: a failed or slow alert must never disturb the
// poller, so errors are swallowed and the request is time-boxed.
async function sendAlert(req: AlertRequest): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);
  try {
    await fetch(req.url, { ...req.init, signal: controller.signal });
  } catch {
    // best-effort
  } finally {
    clearTimeout(timer);
  }
}

// Alert state is held on globalThis so the poller and any other module graph
// share one instance (same reason as the status history store).
const g = globalThis as unknown as {
  __ctrlcenterAlertState?: Map<string, AppAlertState>;
};

function seedState(priorReadings: Map<string, boolean>): Map<string, AppAlertState> {
  const m = new Map<string, AppAlertState>();
  for (const [id, up] of priorReadings) {
    m.set(id, { confirmed: up ? "up" : "down", downStreak: 0 });
  }
  return m;
}

// Called by the poller each tick. `priorReadings` is the last-known up/down per
// app from BEFORE this tick (from history) — used once to seed the in-memory
// state so a restart doesn't re-alert an app that was already down. No-op when
// alerts are disabled or no webhook is set.
export async function processAlerts(
  results: { id: string; up: boolean }[],
  apps: { id: string; name: string; url: string }[],
  config: AlertConfig,
  priorReadings: Map<string, boolean>
): Promise<void> {
  const webhookUrl = config.webhookUrl.trim();
  if (!config.enabled || !webhookUrl) return;
  if (!g.__ctrlcenterAlertState) g.__ctrlcenterAlertState = seedState(priorReadings);
  const { next, events } = evaluateTransitions(g.__ctrlcenterAlertState, results, config);
  g.__ctrlcenterAlertState = next;
  if (events.length === 0) return;
  const byId = new Map(apps.map((a) => [a.id, a]));
  const at = Date.now();
  await Promise.all(
    events.map((e) => {
      const app = byId.get(e.id);
      if (!app) return Promise.resolve();
      return sendAlert(
        buildAlertRequest(config.type, webhookUrl, e, { name: app.name, url: app.url }, at)
      );
    })
  );
}
