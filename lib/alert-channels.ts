// The alert channel list (#291) as both the server and the admin form see it:
// the original single webhook/email keys folded in as list entries, whether a
// channel has enough set to send, and which events it wants. Pure, so the
// form can show the same readiness the poller acts on.
import {
  alertChannelSchema,
  alertEmailSchema,
  type AlertChannel,
  type AlertConfig,
  type ChannelType,
} from "./schema";

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  webhook: "Webhook",
  email: "Email (SMTP)",
  telegram: "Telegram",
  gotify: "Gotify",
  pushover: "Pushover",
  apprise: "Apprise",
};

// Ids for the original keys' entries. List entries get random ids, so these
// can't collide.
export const LEGACY_WEBHOOK_ID = "legacy-webhook";
export const LEGACY_EMAIL_ID = "legacy-email";

export function isLegacyChannel(id: string): boolean {
  return id === LEGACY_WEBHOOK_ID || id === LEGACY_EMAIL_ID;
}

// The original webhook/email keys as channel entries, present only when set
// up (a URL, or any SMTP detail). They take the global notifyOnRecovery and
// alert for every app, as they always did.
export function legacyChannels(config: AlertConfig): AlertChannel[] {
  const out: AlertChannel[] = [];
  const base = { onDown: true, onRecovery: config.notifyOnRecovery, onWebhooks: true };
  if (config.webhookUrl.trim()) {
    out.push(
      alertChannelSchema.parse({
        ...base,
        id: LEGACY_WEBHOOK_ID,
        type: "webhook",
        enabled: config.webhookEnabled,
        format: config.type,
        url: config.webhookUrl,
      })
    );
  }
  const { enabled, ...smtp } = config.email;
  if (smtp.host.trim() || smtp.from.trim() || smtp.to.trim()) {
    out.push(
      alertChannelSchema.parse({ ...base, id: LEGACY_EMAIL_ID, type: "email", enabled, smtp })
    );
  }
  return out;
}

// Every channel, the original keys first.
export function alertChannels(config: AlertConfig): AlertChannel[] {
  return [...legacyChannels(config), ...config.channels];
}

// The settings patch that moves the original keys into the list: same
// destinations, now editable and filterable like any other entry. The old keys
// are reset so they don't send twice.
export function moveLegacyIntoChannels(
  config: AlertConfig,
  newId: () => string
): Pick<AlertConfig, "channels" | "webhookUrl" | "webhookEnabled" | "type" | "email"> {
  const moved = legacyChannels(config).map((ch) => ({ ...ch, id: newId() }));
  return {
    channels: [...moved, ...config.channels],
    webhookUrl: "",
    webhookEnabled: true,
    type: "generic",
    email: alertEmailSchema.parse({}),
  };
}

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
  return alertChannels(config).filter((ch) => ch.enabled && channelReady(ch));
}

// Whether a channel takes an uptime event for this app.
export function wantsAlert(ch: AlertChannel, type: "down" | "up", appId: string): boolean {
  if (!(type === "down" ? ch.onDown : ch.onRecovery)) return false;
  return ch.apps.length === 0 || ch.apps.includes(appId);
}

export function channelLabel(ch: AlertChannel): string {
  return ch.name.trim() || CHANNEL_LABELS[ch.type];
}
