// The alert channel list (#291) as both the server and the admin form see it:
// whether a channel has enough set to send, and which events it wants. Pure,
// so the form can show the same readiness the poller acts on.
import type { AlertChannel, AlertConfig, ChannelType } from "./schema";

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

// Whether a channel takes an uptime event for this app. A cleared warning is
// a recovery from a warning, so it needs both switches.
export function wantsAlert(
  ch: AlertChannel,
  type: "down" | "up" | "warning" | "cleared",
  appId: string
): boolean {
  const wanted = {
    down: ch.onDown,
    up: ch.onRecovery,
    warning: ch.onWarning,
    cleared: ch.onWarning && ch.onRecovery,
  }[type];
  if (!wanted) return false;
  return ch.apps.length === 0 || ch.apps.includes(appId);
}

export function channelLabel(ch: AlertChannel): string {
  return ch.name.trim() || CHANNEL_LABELS[ch.type];
}
