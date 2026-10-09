// What may leave the server (#290 split): the config minus the admin
// credential, and minus every field the schemas mark secret.
import {
  appItemSchema,
  settingsSchema,
  redactSecrets,
  type AppItem,
  type Config,
  type Settings,
} from "../schema";

// The config without the admin credential — what's safe to send over the API
// (export) and the surface an import is allowed to replace. The password lives
// outside this: it's set only through the ChangePassword flow, never carried in
// a backup file. See replaceConfig and the /api/config route.
export function stripAuth(config: Config): Omit<Config, "auth"> {
  const rest = { ...config };
  delete (rest as Partial<Config>).auth;
  return rest;
}

// Blank the secret-bearing settings fields so a signed-out visitor can never
// receive them. Which fields those are is marked on the schemas themselves
// (secretFields in lib/schema/meta.ts, #287): the calendar Basic-auth
// credentials, the alert webhook URL and SMTP details, and — neutralized
// whole — the integrations (#189: URLs map internal topology) and inbound
// webhook tokens — plus, per app, the push-check token (#294). stripAuth only
// removes the top-level admin credential; these secrets live inside
// `settings` and the app rows, where they'd otherwise ride along in
// anything serialized from a public surface. readPublicConfig
// (lib/api-auth.ts) applies this so its result is genuinely safe to hand to a
// client component (#157). The server-side consumers that need the real
// values read them separately — the calendar fetcher via getCalendarAuth, the
// alert poller and the monitor snapshot via readConfigInternal-backed
// accessors.
export function stripSecrets<T extends { settings: Settings; apps?: AppItem[] }>(config: T): T {
  return {
    ...config,
    settings: redactSecrets(settingsSchema, config.settings),
    ...(config.apps ? { apps: config.apps.map((a) => redactSecrets(appItemSchema, a)) } : {}),
  };
}
