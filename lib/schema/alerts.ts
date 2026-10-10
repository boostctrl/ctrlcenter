// Outbound uptime alerts: a list of channels (#291).
import { z } from "zod";
import { secretFields } from "./meta";
import { patchOf } from "./input";
import { lenientArray } from "./shared";

// Redacted from public reads (stripSecrets): credentials, and the addresses
// and endpoints that map where alerts go.
const secret = () => z.string().default("").register(secretFields, { redact: "blank" });

// The payload formats a webhook channel can send.
export const ALERT_TYPES = ["generic", "discord", "slack", "ntfy"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

// An email channel's SMTP settings. Stored leniently; required fields are enforced where a
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
  // Subject template for uptime alerts; {service} and {status} are
  // substituted. Empty = the default "{service} is {status}". A relayed
  // webhook event has its own "[App] Event: Title" subject (#345).
  subject: z.string().default(""),
};
export const smtpSchema = z.object(smtpShape);
export type SmtpConfig = z.infer<typeof smtpSchema>;

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
  // Which events reach this channel: an app going down, coming back up,
  // starting to warn (a certificate near expiry, #310), and the inbound
  // webhook events relayed from Sonarr/Radarr/Seerr (#204).
  onDown: z.boolean().catch(true).default(true),
  onRecovery: z.boolean().catch(true).default(true),
  onWarning: z.boolean().catch(true).default(true),
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

// When status checks are on, the background poller sends to each channel as
// apps go down, recover or start warning.
export const alertsSchema = z.object({
  enabled: z.boolean().default(false),
  // Consecutive failed polls before an app is declared down (flap dampening).
  confirmations: z.number().int().min(1).max(10).default(2),
  // Any number of channels (#291). The single webhook and email keys 2.x kept
  // beside this list were folded into it by the 3.0 migration (#320).
  channels: lenientArray(alertChannelSchema).default([]),
});
export type AlertConfig = z.infer<typeof alertsSchema>;

const httpOrBlank = (url: string | undefined) =>
  url === undefined || url.trim() === "" || /^https?:\/\//i.test(url.trim());

// Admin input, derived from the stored schema (lib/schema/input.ts). A
// channel's URL is optional (it stays inert until one is set), but when
// present it must be http(s). An enabled-but-incomplete channel just stays
// inert (activeChannels skips it), so partially-filled fields never block an
// autosave.
export const alertsUpdateSchema = patchOf(alertsSchema)
  .refine((a) => (a.channels ?? []).every((c) => httpOrBlank(c.url)), {
    message: "Channel URLs must start with http(s)",
    path: ["channels"],
  });
