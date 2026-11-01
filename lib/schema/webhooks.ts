// Inbound webhooks from Sonarr/Radarr/Seerr.
import { z } from "zod";
import { patchOf } from "./input";
import { secretFields } from "./meta";

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
  // A credential (#382): the admin's forms get a placeholder and reveal it
  // behind a confirmation.
  token: z.string().default("").register(secretFields, { redact: "blank", credential: true }),
});
export type WebhookServiceConfig = z.infer<typeof webhookServiceSchema>;

const webhookService = () =>
  webhookServiceSchema.default(webhookServiceSchema.parse({}));

// What a burst may hold together (#359): like events only — a season's
// episodes, a batch of movies, a run of requests, each its own notification
// — everything one app (one sender instance) posts in the window, or
// everything every service posts, as one notification listing each group.
export const DIGEST_SCOPES = ["event", "app", "all"] as const;
export type DigestScope = (typeof DIGEST_SCOPES)[number];

export const webhooksSchema = z.object({
  // Master switch for the inbound endpoint. Off = the route rejects everything
  // even if a token matches, so pasting a URL somewhere can't quietly re-open it.
  enabled: z.boolean().default(false),
  // How long a burst of like events (a season's episodes, one event each) is
  // held before going out as one notification (#346): the wait after the
  // last event, in seconds. 0 relays each event as it arrives. The hard cap
  // on a burst that never goes quiet is five windows, ten minutes at most.
  digestSeconds: z.number().int().min(0).max(300).default(60),
  // Which events share a burst (#359): like events, everything from one
  // app, or everything. Nothing when the window is off.
  digestScope: z.enum(DIGEST_SCOPES).default("event"),
  // What the email report carries (#347; lib/webhook-email.ts): the poster
  // beside the headline, the facts table (quality, size, release group,
  // indexer, requester…) and the synopsis — an overview can spoil an
  // episode. Every other channel gets the one-line summary regardless. All
  // on by default, so a config from before these existed reads the same.
  poster: z.boolean().default(true),
  facts: z.boolean().default(true),
  synopsis: z.boolean().default(true),
  // Put in front of every webhook email subject, for a mail rule to file on.
  // Short: it counts toward the subject's 78-character cap, and the renderer
  // cleans it like any other header text.
  subjectPrefix: z.string().max(40).default(""),
  sonarr: webhookService(),
  radarr: webhookService(),
  seerr: webhookService(),
});
export type WebhooksConfig = z.infer<typeof webhooksSchema>;

// Admin input, derived from the stored schema (lib/schema/input.ts). Tokens
// are stored leniently (the app generates them; there's no user input to
// validate).
export const webhooksUpdateSchema = patchOf(webhooksSchema);
