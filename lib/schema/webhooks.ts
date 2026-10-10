// Inbound webhooks from Sonarr/Radarr/Seerr.
import { z } from "zod";
import { patchOf } from "./input";

// Inbound webhooks (#204): Sonarr/Radarr/Seerr POST an event to us
// ("download complete", "request needs approval", "health issue") and we relay
// it out through the same alert channels as uptime alerts (settings.alerts).
// Polling answers "what's the state now"; this answers "something just
// happened". Each service carries its own token so one can be revoked without
// breaking the others; the token gates the public /api/hooks/<service> route.
// The token is a shared secret the app generates — redacted from public config
// reads (stripSecrets) like the other credentials.
export const WEBHOOK_SERVICES = ["sonarr", "radarr", "seerr"] as const;
export type WebhookService = (typeof WEBHOOK_SERVICES)[number];

export const webhookServiceSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().default(""),
});
export type WebhookServiceConfig = z.infer<typeof webhookServiceSchema>;

const webhookService = () =>
  webhookServiceSchema.default(webhookServiceSchema.parse({}));

export const webhooksSchema = z.object({
  // Master switch for the inbound endpoint. Off = the route rejects everything
  // even if a token matches, so pasting a URL somewhere can't quietly re-open it.
  enabled: z.boolean().default(false),
  sonarr: webhookService(),
  radarr: webhookService(),
  seerr: webhookService(),
});
export type WebhooksConfig = z.infer<typeof webhooksSchema>;

// Admin input, derived from the stored schema (lib/schema/input.ts). Tokens
// are stored leniently (the app generates them; there's no user input to
// validate).
export const webhooksUpdateSchema = patchOf(webhooksSchema);
