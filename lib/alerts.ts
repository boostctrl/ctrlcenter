import type { AlertConfig, AlertEmailConfig, AlertType } from "./schema";
import { log, hostOf, errorReason } from "./log";
import { resolveSecret } from "./secrets";

// Outbound uptime alerting. The background poller (lib/status-poller.ts) feeds
// each tick's results through here; we detect down/recovery transitions and
// notify the configured channels — a webhook and/or email. The transition logic
// and payload shaping are pure (unit-tested); only sendAlert/sendEmailAlert/
// processAlerts do IO.

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

// A free-form notification (an inbound webhook event, #204) rather than an
// up/down transition: a headline plus optional detail and a link.
export type NotificationContent = { title: string; body?: string; url?: string };

// Shape a notification into a request for the chosen channel — the counterpart
// to buildAlertRequest for events that aren't uptime transitions. Reuses each
// channel's body/header conventions so inbound events read like every other
// alert. Pure (no IO), so it's unit-tested directly.
export function buildNotificationRequest(
  type: AlertType,
  webhookUrl: string,
  c: NotificationContent
): AlertRequest {
  const detail = [c.body?.trim(), c.url?.trim()].filter(Boolean).join("\n");
  const text = [c.title, detail].filter(Boolean).join("\n");
  switch (type) {
    case "discord":
      return jsonReq(webhookUrl, { content: text });
    case "slack":
      return jsonReq(webhookUrl, { text });
    case "ntfy": {
      // Title header is latin-1 only (see buildAlertRequest); send it only when
      // ASCII-safe, and put an optional link in the Click header ntfy honors.
      const asciiTitle = /^[\x20-\x7E]*$/.test(c.title) ? c.title : undefined;
      return {
        url: webhookUrl,
        init: {
          method: "POST",
          headers: {
            ...(asciiTitle ? { Title: asciiTitle } : {}),
            ...(c.url ? { Click: c.url } : {}),
          },
          // ntfy needs a non-empty body; fall back to the title when there's no
          // detail so the message never arrives blank.
          body: detail || c.title,
        },
      };
    }
    case "generic":
    default:
      return jsonReq(webhookUrl, {
        title: c.title,
        message: c.body ?? "",
        url: c.url ?? "",
        at: new Date().toISOString(),
      });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Render the subject from its template, substituting {service}/{status}. CR/LF
// are stripped (the service name is admin-controlled but flows into a header) and
// the length is capped; an empty template falls back to the default.
export function renderSubject(
  template: string,
  app: AlertApp,
  down: boolean
): string {
  const status = down ? "down" : "up";
  const out = (template.trim() || "{service} is {status}")
    .replace(/\{service\}/gi, app.name)
    .replace(/\{status\}/gi, status)
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 200);
  return out || `${app.name} is ${status}`;
}

// Email content for an alert (pure, unit-tested): a rendered subject, an HTML
// body, and a plain-text fallback. The body keeps the fixed nice wording while
// the subject is templated.
export function buildEmailMessage(
  event: AlertEvent,
  app: AlertApp,
  at: number,
  subjectTemplate = ""
): { subject: string; text: string; html: string } {
  const down = event.type === "down";
  const title = down ? `${app.name} is down` : `${app.name} recovered`;
  const when = new Date(at).toISOString();
  const subject = renderSubject(subjectTemplate, app, down);
  const text =
    `${down ? "🔴" : "🟢"} ${title}` +
    (app.url ? `\n${app.url}` : "") +
    `\n\nAt ${when}`;
  const accent = down ? "#dc2626" : "#16a34a";
  const urlRow = app.url
    ? `<p style="margin:0 0 4px"><a href="${escapeHtml(app.url)}" style="color:${accent};text-decoration:none">${escapeHtml(app.url)}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;width:100%;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<tr><td style="background:#ffffff;border-radius:12px;border-left:4px solid ${accent};padding:20px 24px">
<p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${accent};font-weight:600">${down ? "Service down" : "Recovered"}</p>
<h1 style="margin:0 0 12px;font-size:18px;color:#18181b">${escapeHtml(title)}</h1>
${urlRow}
<p style="margin:8px 0 0;font-size:12px;color:#71717a">At ${when}</p>
</td></tr>
</table>
</body></html>`;
  return { subject, text, html };
}

// Email content for a free-form notification (#204): the title becomes the
// subject and lead, the body and link fill the card. Pure, unit-tested.
export function buildNotificationEmail(
  c: NotificationContent
): { subject: string; text: string; html: string } {
  const when = new Date().toISOString();
  const subject =
    c.title.replace(/[\r\n]+/g, " ").trim().slice(0, 200) || "Notification";
  const text =
    [c.title, c.body?.trim(), c.url?.trim()].filter(Boolean).join("\n") +
    `\n\nAt ${when}`;
  const accent = "#2563eb";
  const bodyRow = c.body?.trim()
    ? `<p style="margin:0 0 8px;font-size:14px;color:#3f3f46;white-space:pre-line">${escapeHtml(c.body.trim())}</p>`
    : "";
  const urlRow = c.url?.trim()
    ? `<p style="margin:0 0 4px"><a href="${escapeHtml(c.url.trim())}" style="color:${accent};text-decoration:none">${escapeHtml(c.url.trim())}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;width:100%;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<tr><td style="background:#ffffff;border-radius:12px;border-left:4px solid ${accent};padding:20px 24px">
<h1 style="margin:0 0 12px;font-size:18px;color:#18181b">${escapeHtml(c.title)}</h1>
${bodyRow}${urlRow}
<p style="margin:8px 0 0;font-size:12px;color:#71717a">At ${when}</p>
</td></tr>
</table>
</body></html>`;
  return { subject, text, html };
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

// One channel's delivery outcome, reported so a test can show it. `detail` is a
// short human string: for a webhook, the HTTP status ("HTTP 204" / "HTTP 404")
// or the network errorReason on a throw; for email, "sent" or the errorReason.
export type ChannelResult = { ok: boolean; detail: string };

// Fire one webhook, time-boxed, and report the outcome instead of throwing so
// both the poller (which logs) and the test path (which shows the result) can
// share the exact same request logic. Never throws.
async function runAlert(req: AlertRequest): Promise<ChannelResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);
  try {
    const res = await fetch(req.url, { ...req.init, signal: controller.signal });
    return { ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: errorReason(e) };
  } finally {
    clearTimeout(timer);
  }
}

// Fire one webhook, best-effort: a failed or slow alert must never disturb the
// poller, so errors are swallowed and the request is time-boxed.
async function sendAlert(req: AlertRequest): Promise<void> {
  const result = await runAlert(req);
  if (result.ok) return;
  const host = hostOf(req.url);
  const rejected = /^HTTP (\d+)$/.exec(result.detail);
  // The request didn't throw but the endpoint rejected it — surface that, or
  // the alert silently "sent" while nothing was delivered.
  if (rejected) log.warn("alert webhook rejected", { host, status: Number(rejected[1]) });
  else log.warn("alert webhook failed", { host, reason: result.detail });
}


// Send one alert email over SMTP and report the outcome. nodemailer is imported
// lazily so it never lands in a client/edge bundle and only loads inside the
// Node poller. Time-boxed; never throws (mirrors runAlert for the mail path).
// Build a time-boxed SMTP transport from the alert email config. nodemailer is
// imported lazily so it never lands in a client/edge bundle and only loads
// inside the Node poller / webhook route.
async function makeTransport(cfg: AlertEmailConfig) {
  const { default: nodemailer } = await import("nodemailer");
  const pass = resolveSecret("CTRLCENTER_SMTP_PASS", cfg.pass);
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass } : undefined,
    connectionTimeout: ALERT_TIMEOUT_MS,
    greetingTimeout: ALERT_TIMEOUT_MS,
    socketTimeout: ALERT_TIMEOUT_MS,
  });
}

async function runEmailAlert(
  cfg: AlertEmailConfig,
  event: AlertEvent,
  app: AlertApp,
  at: number
): Promise<ChannelResult> {
  try {
    const transport = await makeTransport(cfg);
    const { subject, text, html } = buildEmailMessage(event, app, at, cfg.subject);
    await transport.sendMail({ from: cfg.from, to: cfg.to, subject, text, html });
    return { ok: true, detail: "sent" };
  } catch (e) {
    return { ok: false, detail: errorReason(e) };
  }
}

// Relay one free-form notification out to the configured alert channels (#204),
// best-effort: a failed or slow channel must never block the webhook response,
// so errors are swallowed (and logged). A no-op when neither the webhook nor
// the email channel is configured — the caller checks that first.
export async function sendNotification(
  config: AlertConfig,
  c: NotificationContent
): Promise<void> {
  const webhookUrl = config.webhookUrl.trim();
  const sendWebhook = config.webhookEnabled && webhookUrl !== "";
  const sendEmail = emailReady(config.email);
  const tasks: Promise<void>[] = [];
  if (sendWebhook)
    tasks.push(sendAlert(buildNotificationRequest(config.type, webhookUrl, c)));
  if (sendEmail) {
    tasks.push(
      (async () => {
        try {
          const transport = await makeTransport(config.email);
          const { subject, text, html } = buildNotificationEmail(c);
          await transport.sendMail({
            from: config.email.from,
            to: config.email.to,
            subject,
            text,
            html,
          });
        } catch (e) {
          log.warn("notification email failed", {
            host: config.email.host,
            reason: errorReason(e),
          });
        }
      })()
    );
  }
  await Promise.all(tasks);
}

// Whether any alert channel is configured to receive a relayed notification —
// the webhook route uses this to 503 clearly when there's nowhere to send.
export function anyChannelReady(config: AlertConfig): boolean {
  return (
    (config.webhookEnabled && config.webhookUrl.trim() !== "") ||
    emailReady(config.email)
  );
}

// Send one alert email over SMTP, best-effort. A mail failure must never disturb
// the poller, so it's swallowed here — but logged so a silently-undelivered
// alert can be traced.
async function sendEmailAlert(
  cfg: AlertEmailConfig,
  event: AlertEvent,
  app: AlertApp,
  at: number
): Promise<void> {
  const result = await runEmailAlert(cfg, event, app, at);
  if (!result.ok) log.warn("alert email failed", { host: cfg.host, reason: result.detail });
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

// Whether the email channel has the minimum config to send.
export function emailReady(email: AlertEmailConfig): boolean {
  return !!(
    email.enabled &&
    email.host.trim() &&
    email.from.trim() &&
    email.to.trim()
  );
}

// Send a synthetic "down" alert through the real webhook/email paths so the
// admin can verify each configured channel without waiting for a real outage.
// Unlike the poller this reports every attempted channel's outcome (and never
// throws), and deliberately ignores `config.enabled` — the master switch gates
// the poller, not the admin's ability to test a channel. Both channels are sent
// in parallel; the result carries a key only for the channels we attempted.
export async function sendTestAlert(
  config: AlertConfig
): Promise<{ webhook?: ChannelResult; email?: ChannelResult }> {
  const event: AlertEvent = { id: "test", type: "down" };
  // A distinctly-named app so the notification reads "🔴 CtrlCenter test alert
  // is down" — unmistakably a test, yet still exercising the real down-path
  // formatting (ntfy priority/tags, the email subject template, etc.).
  const app: AlertApp = { name: "CtrlCenter test alert", url: "" };
  const at = Date.now();
  const webhookUrl = config.webhookUrl.trim();
  const testWebhook = config.webhookEnabled && webhookUrl !== "";
  const testEmail = emailReady(config.email);
  const [webhook, email] = await Promise.all([
    testWebhook
      ? runAlert(buildAlertRequest(config.type, webhookUrl, event, app, at))
      : Promise.resolve(undefined),
    testEmail ? runEmailAlert(config.email, event, app, at) : Promise.resolve(undefined),
  ]);
  const out: { webhook?: ChannelResult; email?: ChannelResult } = {};
  if (webhook) out.webhook = webhook;
  if (email) out.email = email;
  return out;
}

// Called by the poller each tick. `priorReadings` is the last-known up/down per
// app from BEFORE this tick (from history) — used once to seed the in-memory
// state so a restart doesn't re-alert an app that was already down. No-op when
// alerts are off or no channel (webhook or email) is configured. A single
// transition fans out to every configured channel.
export async function processAlerts(
  results: { id: string; up: boolean }[],
  apps: { id: string; name: string; url: string }[],
  config: AlertConfig,
  priorReadings: Map<string, boolean>
): Promise<void> {
  if (!config.enabled) return;
  const webhookUrl = config.webhookUrl.trim();
  const sendWebhook = config.webhookEnabled && webhookUrl !== "";
  const sendEmail = emailReady(config.email);
  if (!sendWebhook && !sendEmail) return;
  if (!g.__ctrlcenterAlertState) g.__ctrlcenterAlertState = seedState(priorReadings);
  const { next, events } = evaluateTransitions(g.__ctrlcenterAlertState, results, config);
  g.__ctrlcenterAlertState = next;
  if (events.length === 0) return;
  const byId = new Map(apps.map((a) => [a.id, a]));
  const at = Date.now();
  await Promise.all(
    events.flatMap((e) => {
      const found = byId.get(e.id);
      if (!found) return [];
      const app = { name: found.name, url: found.url };
      log.info("alert firing", {
        app: found.name,
        event: e.type,
        webhook: sendWebhook,
        email: sendEmail,
      });
      const tasks: Promise<void>[] = [];
      if (sendWebhook)
        tasks.push(sendAlert(buildAlertRequest(config.type, webhookUrl, e, app, at)));
      if (sendEmail) tasks.push(sendEmailAlert(config.email, e, app, at));
      return tasks;
    })
  );
}
