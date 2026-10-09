// Connections to other self-hosted services (Monitor dashboard).
import { z } from "zod";
import { patchOf } from "./input";

// --- Integrations (#189): connections to other self-hosted services, shown
// only on the private Monitor dashboard (/admin/monitor). Read-only in the
// 2.3.x–2.4.x arc. Stored leniently like every settings section. The
// credentials are secrets — and the URLs are internal topology — so the
// whole section is marked secret (settingsSchema) and stripSecrets
// neutralizes it in anything a public surface serializes (#157); each
// credential can also come from a CTRLCENTER_* env
// var instead of the file (resolved at use time in lib/services/*).
//
// Two credential shapes cover every service: a WebUI login
// (username/password) and an API key. A new service reuses one of these and
// adds its id to integrationsSchema + the registry (lib/services/registry.ts).
// Opt-in, default off: skip TLS certificate verification for this service.
// Only honored by clients that support it (UniFi) and only for an https URL —
// it exists for controllers that ship a self-signed cert with no plaintext
// alternative. Not a secret (a boolean), so stripSecrets leaves it intact.
//
// `allowActions` is the write-side opt-in (#201/#202/#203): default off, so a
// configured integration stays read-only until the admin turns it on. Only the
// action-capable services (qBittorrent, Seerr, Portainer) expose the toggle and
// honor it; every service carries the field so both credential shapes share one
// schema. Public redaction forces every boolean off too, so this can't leak
// either.
export const userPassIntegrationSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(""),
  username: z.string().default(""),
  password: z.string().default(""),
  allowInsecureTls: z.boolean().default(false),
  allowActions: z.boolean().default(false),
});
export type UserPassIntegration = z.infer<typeof userPassIntegrationSchema>;

export const apiKeyIntegrationSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(""),
  apiKey: z.string().default(""),
  allowInsecureTls: z.boolean().default(false),
  allowActions: z.boolean().default(false),
});
export type ApiKeyIntegration = z.infer<typeof apiKeyIntegrationSchema>;

const userPass = () =>
  userPassIntegrationSchema.default(userPassIntegrationSchema.parse({}));
const apiKey = () =>
  apiKeyIntegrationSchema.default(apiKeyIntegrationSchema.parse({}));

export const integrationsSchema = z.object({
  qbittorrent: userPass(),
  sonarr: apiKey(),
  radarr: apiKey(),
  adguard: userPass(),
  tautulli: apiKey(),
  seerr: apiKey(),
  portainer: apiKey(),
  truenas: apiKey(),
  unifi: userPass(),
});
export type IntegrationsConfig = z.infer<typeof integrationsSchema>;

// Admin input, derived from the stored schema (lib/schema/input.ts).
//
// No URL-format refine here on purpose: because the entire Settings object is
// one autosave PUT, a refine failure on a half-typed integration URL (e.g. a
// schemeless "192.168.1.10:8080" pasted straight from the service's own UI)
// would 400 the whole request and block saving every OTHER section too, with
// only a generic "Couldn't save". Integration URLs are validated at point of
// use instead — serviceBase() (lib/services/http.ts) rejects a non-http(s)
// URL with a clear message shown on the Monitor card and the Test-connection
// button — and stored leniently, so a bad value stays inert rather than
// wedging the admin form.
export const integrationsUpdateSchema = patchOf(integrationsSchema);
