// Outbound uptime alerts (webhook + email channels).
import { z } from "zod";
import { secretFields } from "./meta";
import { patchOf } from "./input";
import { lenientArray } from "./shared";

// Redacted from public reads (stripSecrets): credentials, and the addresses
// and endpoints that map where alerts go.
const secret = () => z.string().default("").register(secretFields, { redact: "blank" });

// Outbound uptime alerts. When status checks are on, the background poller can
// POST to a webhook as apps transition down (or recover). Stored leniently so a
// hand-edited file always parses; the URL is validated on the admin-input path.
export const ALERT_TYPES = ["generic", "discord", "slack", "ntfy"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

// SMTP settings, shared by the original email channel and email entries in
// the channel list. Stored leniently; required fields are enforced where a
// channel is checked for readiness. The password can also come from the
// CTRLCENTER_SMTP_PASS env var to keep it out of the file.
const smtpShape = {
  host: secret(),
  port: z.number().int().min(1).max(65535).default(587),
  // Implicit TLS (port 465). Leave off for 587/STARTTLS, which nodemailer
  // upgrades automatically.
  secure: z.boolean().default(false),
  user: secret(),
  pass: secret(),
  from: secret(),
  to: secret(),
  // Subject template; {service} and {status} are substituted. Empty = the
  // default "{service} is {status}".
  subject: z.string().default(""),
};
export const smtpSchema = z.object(smtpShape);
export type SmtpConfig = z.infer<typeof smtpSchema>;

// The original email (SMTP) alert channel, dispatched alongside the webhook.
export const alertEmailSchema = z.object({
  enabled: z.boolean().default(false),
  ...smtpShape,
});
export type AlertEmailConfig = z.infer<typeof alertEmailSchema>;

// One entry in the channel list (#291). Flat: each type reads the fields it
// needs and ignores the rest, so switching a channel's type in the form keeps
// what was typed. Unknown types or broken entries are dropped on read
// (lenientArray), never failing the whole config.
export const CHANNEL_TYPES = ["webhook", "email", "telegram", "gotify", "pushover", "apprise"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const alertChannelSchema = z.object({
  id: z.string().min(1),
  type: z.enum(CHANNEL_TYPES),
  // A label for the admin's own reference; empty shows the type's name.
  name: z.string().catch("").default(""),
  enabled: z.boolean().catch(true).default(true),
  // Which events reach this channel: an app going down, coming back up, and
  // the inbound webhook events relayed from Sonarr/Radarr/Seerr (#204).
  onDown: z.boolean().catch(true).default(true),
  onRecovery: z.boolean().catch(true).default(true),
  onWebhooks: z.boolean().catch(true).default(true),
  // Only alert for these app ids; empty means every monitored app.
  apps: z.array(z.string()).catch([]).default([]),
  // Webhook: which service's payload to send.
  format: z.enum(ALERT_TYPES).catch("generic").default("generic"),
  // Webhook, Gotify server and Apprise API endpoint.
  url: secret(),
  // Telegram bot token, Gotify app token, Pushover app token.
  token: secret(),
  // Telegram chat id.
  chatId: secret(),
  // Pushover user (or group) key.
  userKey: secret(),
  smtp: smtpSchema.default(smtpSchema.parse({})),
});
export type AlertChannel = z.infer<typeof alertChannelSchema>;

export const alertsSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(ALERT_TYPES).default("generic"),
  webhookUrl: secret(),
  // Webhook channel on/off, independent of the email channel. Defaults true so an
  // existing config with a webhook URL keeps sending; the webhook fires only when
  // this is on AND a URL is set.
  webhookEnabled: z.boolean().default(true),
  // Also notify when a down app comes back up. Applies to the original
  // webhook/email keys; list entries have their own onRecovery.
  notifyOnRecovery: z.boolean().default(true),
  // Consecutive failed polls before an app is declared down (flap dampening).
  confirmations: z.number().int().min(1).max(10).default(2),
  email: alertEmailSchema.default(alertEmailSchema.parse({})),
  // Any number of channels (#291). The single webhook/email keys above keep
  // working through 2.x; 3.0 moves them into this list.
  channels: lenientArray(alertChannelSchema).default([]),
});
export type AlertConfig = z.infer<typeof alertsSchema>;

const httpOrBlank = (url: string | undefined) =>
  url === undefined || url.trim() === "" || /^https?:\/\//i.test(url.trim());

// Admin input, derived from the stored schema (lib/schema/input.ts). A
// webhook URL is optional (alerts stay inert until one is set), but when
// present it must be http(s); so must a channel's URL. The email channel is lenient: an
// enabled-but-incomplete one just stays inert (processAlerts gates sending on
// emailReady), so partially-filled fields never block an autosave.
export const alertsUpdateSchema = patchOf(alertsSchema)
  .refine((a) => httpOrBlank(a.webhookUrl), {
    message: "Webhook URL must start with http(s)",
    path: ["webhookUrl"],
  })
  .refine((a) => (a.channels ?? []).every((c) => httpOrBlank(c.url)), {
    message: "Channel URLs must start with http(s)",
    path: ["channels"],
  });
