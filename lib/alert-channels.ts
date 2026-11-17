// The alert channel list (#291) as both the server and the admin form see it:
// whether a channel has enough set to send, and which events it wants. Pure,
// so the form can show the same readiness the poller acts on.
import type { AlertChannel, AlertConfig, ChannelType, InstanceOf, WidgetInstance } from "./schema";

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  webhook: "Webhook",
  email: "Email (SMTP)",
  telegram: "Telegram",
  gotify: "Gotify",
  pushover: "Pushover",
  apprise: "Apprise",
};

// The fields a channel can't send without, as short names for the form's hint.
export function missingFields(ch: AlertChannel): string[] {
  const need = (ok: boolean, label: string) => (ok ? [] : [label]);
  const set = (v: string) => v.trim() !== "";
  switch (ch.type) {
    case "webhook":
      return need(set(ch.url), "a webhook URL");
    case "email":
      return [
        ...need(set(ch.smtp.host), "an SMTP host"),
        ...need(set(ch.smtp.from), "a from address"),
        ...need(set(ch.smtp.to), "a to address"),
      ];
    case "telegram":
      return [...need(set(ch.token), "a bot token"), ...need(set(ch.chatId), "a chat ID")];
    case "gotify":
      return [...need(set(ch.url), "a server URL"), ...need(set(ch.token), "an app token")];
    case "pushover":
      return [...need(set(ch.token), "an app token"), ...need(set(ch.userKey), "a user key")];
    case "apprise":
      return need(set(ch.url), "an Apprise URL");
  }
}

export function channelReady(ch: AlertChannel): boolean {
  return missingFields(ch).length === 0;
}

// The channels that would send right now: switched on and complete.
export function activeChannels(config: AlertConfig): AlertChannel[] {
  return config.channels.filter((ch) => ch.enabled && channelReady(ch));
}

// What an alert is about (#559): an app going down, recovering or warning;
// next, a widget crossing its thresholds (#539) and an integration's health
// (#540). `id` is the thing's own id, which a rename leaves alone: the
// generic webhook sends it, and with `kind` it is what a channel's filter
// names (subjectFilterKey). `name` and `url` are what the alert shows.
export type AlertSubjectKind = "app" | "widget" | "integration";
export type AlertSubject = { kind: AlertSubjectKind; id: string; name: string; url: string };

// A subject as a channel's filter names it: an app by its id, as the filter
// always has, and anything else by its kind and id ("widget:<id>"). App ids
// are slugs, which never hold a colon, so the two can't meet; and a filter
// someone narrowed to some apps names no widget or integration, so it never
// starts taking the new kinds.
export function subjectFilterKey(s: Pick<AlertSubject, "kind" | "id">): string {
  return s.kind === "app" ? s.id : `${s.kind}:${s.id}`;
}

// Whether a channel takes this event about this subject. A cleared warning is
// a recovery from a warning, so it needs both switches.
export function wantsAlert(
  ch: AlertChannel,
  type: "down" | "up" | "warning" | "cleared",
  subject: Pick<AlertSubject, "kind" | "id">
): boolean {
  const wanted = {
    down: ch.onDown,
    up: ch.onRecovery,
    warning: ch.onWarning,
    cleared: ch.onWarning && ch.onRecovery,
  }[type];
  if (!wanted) return false;
  return ch.apps.length === 0 || ch.apps.includes(subjectFilterKey(subject));
}

// The API widgets that send alerts (#539): showing one number, with the
// switch on and a threshold to cross. The server checks these, and a
// channel's filter offers them.
type ApiWidget = InstanceOf<"api">;
export function alertingWidgets(widgets: readonly WidgetInstance[]): ApiWidget[] {
  return widgets.filter(
    (w): w is ApiWidget =>
      w.type === "api" &&
      w.alerts === true &&
      (w.display === "stat" || w.display === "gauge") &&
      (w.thresholds.warn !== null || w.thresholds.critical !== null)
  );
}

// What an alert calls such a widget: its title, else its field's label,
// else what the admin calls it (`labels`, lib/widgets/labels.ts: "API 2").
export function widgetAlertName(w: ApiWidget, labels: Record<string, string>): string {
  return w.title.trim() || w.fields[0]?.label.trim() || labels[w.id] || "API widget";
}

export function channelLabel(ch: AlertChannel): string {
  return ch.name.trim() || CHANNEL_LABELS[ch.type];
}

// Each channel's label told from its namesakes' (#434), keyed by id: two
// unnamed webhooks are "Webhook" and "Webhook 2" — the first keeps the plain
// label, the rest are numbered by position among the channels sharing it,
// skipping a number some channel carries by name — and a label no other
// channel has stays as it is. By id so that a filtered list, such as the
// preview's receivers, names a channel as the full list does.
export function uniqueChannelLabels(channels: AlertChannel[]): Map<string, string> {
  const plain = channels.map((ch) => [ch.id, channelLabel(ch)] as const);
  const taken = new Set(plain.map(([, label]) => label));
  const seen = new Set<string>();
  const labels = new Map<string, string>();
  for (const [id, base] of plain) {
    let label = base;
    if (seen.has(base)) {
      let n = 2;
      while (taken.has(`${base} ${n}`)) n++;
      label = `${base} ${n}`;
      taken.add(label);
    }
    seen.add(base);
    labels.set(id, label);
  }
  return labels;
}

// A namer for the channels of one list: each channel's label as
// uniqueChannelLabels tells it from its namesakes, so the settings form, the
// test and sample results and the log lines all call the second unnamed
// webhook "Webhook 2" (#442). A channel not in the list keeps its plain label.
export function channelNamer(channels: AlertChannel[]): (ch: AlertChannel) => string {
  const labels = uniqueChannelLabels(channels);
  return (ch) => labels.get(ch.id) ?? channelLabel(ch);
}
