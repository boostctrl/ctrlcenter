// Outbound uptime alerts (webhook + email channels).
import { z } from "zod";

// Outbound uptime alerts. When status checks are on, the background poller can
// POST to a webhook as apps transition down (or recover). Stored leniently so a
// hand-edited file always parses; the URL is validated on the admin-input path.
export const ALERT_TYPES = ["generic", "discord", "slack", "ntfy"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

// Optional email (SMTP) alert channel, dispatched alongside the webhook. Stored
// leniently; required fields are enforced on the admin-input path. The password
// can also come from the CTRLCENTER_SMTP_PASS env var to keep it out of the file.
export const alertEmailSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().default(""),
  port: z.number().int().min(1).max(65535).default(587),
  // Implicit TLS (port 465). Leave off for 587/STARTTLS, which nodemailer
  // upgrades automatically.
  secure: z.boolean().default(false),
  user: z.string().default(""),
  pass: z.string().default(""),
  from: z.string().default(""),
  to: z.string().default(""),
  // Subject template; {service} and {status} are substituted. Empty = the
  // default "{service} is {status}".
  subject: z.string().default(""),
});
export type AlertEmailConfig = z.infer<typeof alertEmailSchema>;

export const alertsSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(ALERT_TYPES).default("generic"),
  webhookUrl: z.string().default(""),
  // Webhook channel on/off, independent of the email channel. Defaults true so an
  // existing config with a webhook URL keeps sending; the webhook fires only when
  // this is on AND a URL is set.
  webhookEnabled: z.boolean().default(true),
  // Also notify when a down app comes back up.
  notifyOnRecovery: z.boolean().default(true),
  // Consecutive failed polls before an app is declared down (flap dampening).
  confirmations: z.number().int().min(1).max(10).default(2),
  email: alertEmailSchema.default(alertEmailSchema.parse({})),
});
export type AlertConfig = z.infer<typeof alertsSchema>;

// Admin sends the whole alerts object. A webhook URL is optional (alerts stay
// inert until one is set), but when present it must be http(s).
// Lenient like the webhook URL: an enabled-but-incomplete email channel just
// stays inert (processAlerts gates sending on emailReady), so partially-filled
// fields never block an autosave. The admin UI nudges to finish the config.
// Optional in the parent so older clients can omit it.
export const alertEmailUpdateSchema = z.object({
  enabled: z.boolean(),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  subject: z.string(),
  user: z.string(),
  pass: z.string(),
  from: z.string(),
  to: z.string(),
});

export const alertsUpdateSchema = z
  .object({
    enabled: z.boolean(),
    type: z.enum(ALERT_TYPES),
    webhookUrl: z.string(),
    webhookEnabled: z.boolean().optional(),
    notifyOnRecovery: z.boolean(),
    confirmations: z.number().int().min(1).max(10),
    email: alertEmailUpdateSchema.optional(),
  })
  .refine(
    (a) => a.webhookUrl.trim() === "" || /^https?:\/\//i.test(a.webhookUrl.trim()),
    { message: "Webhook URL must start with http(s)", path: ["webhookUrl"] }
  );
