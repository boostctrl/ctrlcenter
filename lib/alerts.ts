import type { AlertChannel, AlertConfig, AlertType, SmtpConfig } from "./schema";
import {
  activeChannels,
  channelLabel,
  channelReady,
  wantsAlert,
} from "./alert-channels";
import { log, hostOf, errorReason } from "./log";
import { resolveSecret } from "./secrets";
import { fetchWithTimeout } from "./fetch-body";

// Outbound uptime alerting. The background poller (lib/status-poller.ts) feeds
// each tick's results through here; we detect down/recovery transitions and
// notify the configured channels (lib/alert-channels.ts). The transition logic
// and payload shaping are pure (unit-tested); only the delivery functions at
// the bottom do IO.

// "warning" and "cleared" are an up app entering and leaving the warning
// state (#310), e.g. a certificate near expiry; `detail` carries the text.
export type AlertEventType = "down" | "up" | "warning" | "cleared";
export type AlertEvent = { id: string; type: AlertEventType; detail?: string };

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

// Warning state per app (#310): when the last warning alert went out, and
// whether a failed check has come between.
export type WarnState = { lastSent: number; failed?: boolean };

// While an app stays in warning, remind once a day: a certificate a week from
// lapsing deserves more than one notification, but not one per check.
export const WARNING_REMIND_MS = 24 * 60 * 60 * 1000;

// Pure warning step, alongside evaluateTransitions: alert when an up app starts
// warning, remind every `remindMs` while it stays that way, and note when the
// warning clears. A failed check keeps the state, so a blip doesn't re-announce
// the warning; and an app coming back from a failure without its warning gets
// no "cleared" note (its down/recovery alerts covered that stretch).
export function evaluateWarnings(
  prev: Map<string, WarnState>,
  results: { id: string; up: boolean; warning?: string }[],
  now: number,
  remindMs = WARNING_REMIND_MS
): { next: Map<string, WarnState>; events: AlertEvent[] } {
  const next = new Map(prev);
  const events: AlertEvent[] = [];
  for (const r of results) {
    const cur = next.get(r.id);
    if (!r.up) {
      if (cur) next.set(r.id, { ...cur, failed: true });
    } else if (r.warning) {
      if (!cur || now - cur.lastSent >= remindMs) {
        events.push({ id: r.id, type: "warning", detail: r.warning });
        next.set(r.id, { lastSent: now });
      } else if (cur.failed) {
        next.set(r.id, { lastSent: cur.lastSent });
      }
    } else if (cur) {
      if (!cur.failed) events.push({ id: r.id, type: "cleared" });
      next.delete(r.id);
    }
  }
  return { next, events };
}

export type AlertApp = { name: string; url: string };
export type AlertRequest = { url: string; init: RequestInit };

// The words and look of one event, shared by every format. `status` is what
// the email subject's {status} becomes.
export function describeAlert(
  event: AlertEvent,
  app: AlertApp
): { title: string; emoji: string; status: string; label: string; accent: string } {
  switch (event.type) {
    case "down":
      return { title: `${app.name} is down`, emoji: "🔴", status: "down", label: "Service down", accent: "#dc2626" };
    case "warning":
      return {
        title: `${app.name}: ${event.detail || "warning"}`,
        emoji: "🟠",
        status: "warning",
        label: "Warning",
        accent: "#d97706",
      };
    case "cleared":
      return { title: `${app.name}: warning cleared`, emoji: "🟢", status: "up", label: "Cleared", accent: "#16a34a" };
    case "up":
    default:
      return { title: `${app.name} recovered`, emoji: "🟢", status: "up", label: "Recovered", accent: "#16a34a" };
  }
}

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
  const { title, emoji } = describeAlert(event, app);
  const text = `${emoji} ${title}`;
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
            Priority: event.type === "down" ? "high" : "default",
            Tags:
              event.type === "down"
                ? "red_circle"
                : event.type === "warning"
                  ? "warning"
                  : "green_circle",
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
        ...(event.detail ? { detail: event.detail } : {}),
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

// The link line of an alert email. Only http(s) URLs become a link: the URL
// can come from an inbound webhook payload (#204), and a javascript: or data:
// href in an HTML email is a phishing/XSS vector in mail clients that honor
// it. Anything else still shows, as plain text.
function linkRow(url: string, accent: string): string {
  const safe = escapeHtml(url);
  const body = /^https?:\/\//i.test(url)
    ? `<a href="${safe}" style="color:${accent};text-decoration:none">${safe}</a>`
    : safe;
  return `<p style="margin:0 0 4px">${body}</p>`;
}

// Render the subject from its template, substituting {service}/{status}
// (down, up or warning). CR/LF
// are stripped (the service name is admin-controlled but flows into a header) and
// the length is capped; an empty template falls back to the default.
export function renderSubject(
  template: string,
  app: AlertApp,
  status: string
): string {
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
  const { title, emoji, status, label, accent } = describeAlert(event, app);
  const when = new Date(at).toISOString();
  // A warning's subject leads with its detail; a custom template still wins.
  const subject =
    event.type === "warning" || event.type === "cleared"
      ? renderSubject(subjectTemplate || title, app, status)
      : renderSubject(subjectTemplate, app, status);
  const text = `${emoji} ${title}` + (app.url ? `\n${app.url}` : "") + `\n\nAt ${when}`;
  const urlRow = app.url ? linkRow(app.url, accent) : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;width:100%;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<tr><td style="background:#ffffff;border-radius:12px;border-left:4px solid ${accent};padding:20px 24px">
<p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${accent};font-weight:600">${label}</p>
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
  const urlRow = c.url?.trim() ? linkRow(c.url.trim(), accent) : "";
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

// What the services without a webhook-style payload get (Telegram, Gotify,
// Pushover, Apprise): a title, a body for services that show the title
// separately, the whole text for those that don't, an optional link, and
// how urgent it is.
export type PlainMessage = {
  title: string;
  body: string;
  text: string;
  url?: string;
  level: "down" | "warning" | "up" | "info";
};

export function plainAlert(event: AlertEvent, app: AlertApp): PlainMessage {
  const { title, emoji } = describeAlert(event, app);
  const body = `${emoji} ${title}`;
  const level = event.type === "down" || event.type === "warning" ? event.type : "up";
  return { title, body, text: body, url: app.url.trim() || undefined, level };
}

export function plainNotification(c: NotificationContent): PlainMessage {
  const detail = c.body?.trim() ?? "";
  return {
    title: c.title,
    body: detail || c.title,
    text: [c.title, detail].filter(Boolean).join("\n"),
    url: c.url?.trim() || undefined,
    level: "info",
  };
}

// Telegram caps a message at 4096 characters; leave room for the link.
const MAX_TEXT = 3500;
const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);
const withLink = (s: string, url?: string) => (url ? `${clip(s)}\n${url}` : clip(s));

// Shape a message into the request one of the native services expects (#291).
// Pure, so each service's payload is unit-tested.
export function buildServiceRequest(
  ch: Pick<AlertChannel, "type" | "url" | "token" | "chatId" | "userKey">,
  m: PlainMessage
): AlertRequest {
  switch (ch.type) {
    case "telegram":
      // Plain text: no parse_mode, so names with * or _ need no escaping.
      return jsonReq(`https://api.telegram.org/bot${ch.token.trim()}/sendMessage`, {
        chat_id: ch.chatId.trim(),
        text: withLink(m.text, m.url),
        disable_web_page_preview: true,
      });
    case "gotify":
      return {
        url: `${ch.url.trim().replace(/\/+$/, "")}/message`,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Gotify-Key": ch.token.trim() },
          body: JSON.stringify({
            title: m.title,
            message: withLink(m.body, m.url),
            priority: m.level === "down" ? 8 : m.level === "warning" ? 6 : 5,
          }),
        },
      };
    case "pushover": {
      const form = new URLSearchParams({
        token: ch.token.trim(),
        user: ch.userKey.trim(),
        title: m.title.slice(0, 250),
        message: clip(m.body).slice(0, 1024),
        priority: m.level === "down" ? "1" : "0",
      });
      if (m.url && /^https?:\/\//i.test(m.url)) form.set("url", m.url.slice(0, 512));
      return {
        url: "https://api.pushover.net/1/messages.json",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        },
      };
    }
    case "apprise":
    default:
      // The Apprise API's /notify endpoint: it fans out to whatever services
      // its URL (a stateless /notify or a saved /notify/<key>) points at.
      return jsonReq(ch.url.trim(), {
        title: m.title,
        body: withLink(m.body, m.url),
        type: { down: "failure", warning: "warning", up: "success", info: "info" }[m.level],
      });
  }
}

// One thing to deliver: an uptime transition, or a relayed notification.
type Outgoing =
  | { kind: "alert"; event: AlertEvent; app: AlertApp; at: number }
  | { kind: "notification"; content: NotificationContent };

// The HTTP request for one channel and one message (every type but email).
function requestFor(ch: AlertChannel, out: Outgoing): AlertRequest {
  if (ch.type === "webhook") {
    const url = ch.url.trim();
    return out.kind === "alert"
      ? buildAlertRequest(ch.format, url, out.event, out.app, out.at)
      : buildNotificationRequest(ch.format, url, out.content);
  }
  return buildServiceRequest(
    ch,
    out.kind === "alert" ? plainAlert(out.event, out.app) : plainNotification(out.content)
  );
}

// One channel's delivery outcome, reported so a test can show it. `detail` is a
// short human string: for an HTTP channel, the status ("HTTP 204" / "HTTP 404")
// or the network errorReason on a throw; for email, "sent" or the errorReason.
export type ChannelResult = { ok: boolean; detail: string };

// Fire one request, time-boxed, and report the outcome instead of throwing so
// both the poller (which logs) and the test path (which shows the result) share
// the exact same request logic.
async function runRequest(req: AlertRequest): Promise<ChannelResult> {
  try {
    const res = await fetchWithTimeout(req.url, req.init, ALERT_TIMEOUT_MS);
    return { ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: errorReason(e) };
  }
}

// Build a time-boxed SMTP transport. nodemailer is imported lazily so it never
// lands in a client/edge bundle and only loads inside the Node poller /
// webhook route.
async function makeTransport(cfg: SmtpConfig) {
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

async function runEmail(cfg: SmtpConfig, out: Outgoing): Promise<ChannelResult> {
  try {
    const transport = await makeTransport(cfg);
    const { subject, text, html } =
      out.kind === "alert"
        ? buildEmailMessage(out.event, out.app, out.at, cfg.subject)
        : buildNotificationEmail(out.content);
    await transport.sendMail({ from: cfg.from, to: cfg.to, subject, text, html });
    return { ok: true, detail: "sent" };
  } catch (e) {
    return { ok: false, detail: errorReason(e) };
  }
}

// Deliver to one channel. Never throws.
function deliver(ch: AlertChannel, out: Outgoing): Promise<ChannelResult> {
  return ch.type === "email" ? runEmail(ch.smtp, out) : runRequest(requestFor(ch, out));
}

// Deliver best-effort: a failed or slow channel must never disturb the poller
// or the webhook response, so failures are swallowed, but logged so an
// undelivered alert can be traced. Only the host is logged: Telegram's URL
// carries the bot token.
async function deliverLogged(ch: AlertChannel, out: Outgoing): Promise<void> {
  const result = await deliver(ch, out);
  if (result.ok) return;
  log.warn("alert channel failed", {
    channel: channelLabel(ch),
    host: ch.type === "email" ? ch.smtp.host : hostOf(requestFor(ch, out).url),
    reason: result.detail,
  });
}

// Relay one free-form notification (#204) out to every active channel that
// takes inbound webhook events. A no-op when there's none; the caller checks
// anyChannelReady first to answer clearly.
export async function sendNotification(
  config: AlertConfig,
  c: NotificationContent
): Promise<void> {
  const channels = activeChannels(config).filter((ch) => ch.onWebhooks);
  await Promise.all(channels.map((ch) => deliverLogged(ch, { kind: "notification", content: c })));
}

// Whether any channel would receive a relayed notification: the webhook route
// uses this to say clearly when there's nowhere to send.
export function anyChannelReady(config: AlertConfig): boolean {
  return activeChannels(config).some((ch) => ch.onWebhooks);
}

// Alert state is held on globalThis so the poller and any other module graph
// share one instance (same reason as the status history store).
const g = globalThis as unknown as {
  __ctrlcenterAlertState?: Map<string, AppAlertState>;
  __ctrlcenterWarnState?: Map<string, WarnState>;
};

function seedState(priorReadings: Map<string, boolean>): Map<string, AppAlertState> {
  const m = new Map<string, AppAlertState>();
  for (const [id, up] of priorReadings) {
    m.set(id, { confirmed: up ? "up" : "down", downStreak: 0 });
  }
  return m;
}

export type TestResult = ChannelResult & { id: string; label: string };

// Send a synthetic "down" alert through the real delivery path so the admin
// can check a channel without waiting for a real outage. With `channelId`,
// that one channel is tested even while switched off (it's being set up);
// without, every active one. Ignores `config.enabled`: the master switch gates
// the poller, not the admin's test. Channels missing a required field are
// skipped; the form says what's missing. Never throws.
export async function sendTestAlert(
  config: AlertConfig,
  channelId?: string
): Promise<{ results: TestResult[] }> {
  const channels =
    channelId === undefined
      ? activeChannels(config)
      : config.channels.filter((ch) => ch.id === channelId && channelReady(ch));
  // A distinctly-named app so the notification reads "🔴 CtrlCenter test alert
  // is down": unmistakably a test, yet the real down-path formatting (ntfy
  // priority/tags, the email subject template, etc.).
  const out: Outgoing = {
    kind: "alert",
    event: { id: "test", type: "down" },
    app: { name: "CtrlCenter test alert", url: "" },
    at: Date.now(),
  };
  const results = await Promise.all(
    channels.map(async (ch) => ({ id: ch.id, label: channelLabel(ch), ...(await deliver(ch, out)) }))
  );
  return { results };
}

// Called by the poller each tick. `priorReadings` is the last-known up/down per
// app from BEFORE this tick (from history), used once to seed the in-memory
// state so a restart doesn't re-alert an app that was already down. No-op when
// alerts are off or no channel is active. Each transition (and warning) goes
// to every channel whose event and app filters take it.
export async function processAlerts(
  results: { id: string; up: boolean; warning?: string }[],
  apps: { id: string; name: string; url: string }[],
  config: AlertConfig,
  priorReadings: Map<string, boolean>
): Promise<void> {
  if (!config.enabled) return;
  const channels = activeChannels(config);
  if (channels.length === 0) return;
  if (!g.__ctrlcenterAlertState) g.__ctrlcenterAlertState = seedState(priorReadings);
  // Recoveries are always computed; each channel decides whether it wants them.
  const { next, events } = evaluateTransitions(g.__ctrlcenterAlertState, results, {
    confirmations: config.confirmations,
    notifyOnRecovery: true,
  });
  g.__ctrlcenterAlertState = next;
  // Warnings keep their own state (#310). Not persisted: after a restart an
  // app still warning is announced once more.
  const warned = evaluateWarnings(g.__ctrlcenterWarnState ?? new Map(), results, Date.now());
  g.__ctrlcenterWarnState = warned.next;
  events.push(...warned.events);
  if (events.length === 0) return;
  const byId = new Map(apps.map((a) => [a.id, a]));
  const at = Date.now();
  await Promise.all(
    events.flatMap((e) => {
      const found = byId.get(e.id);
      if (!found) return [];
      const targets = channels.filter((ch) => wantsAlert(ch, e.type, e.id));
      log.info("alert firing", {
        app: found.name,
        event: e.type,
        channels: targets.map(channelLabel).join(", ") || "none",
      });
      const out: Outgoing = {
        kind: "alert",
        event: e,
        app: { name: found.name, url: found.url },
        at,
      };
      return targets.map((ch) => deliverLogged(ch, out));
    })
  );
}
