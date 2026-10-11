// What may leave the server (#290 split): the config minus the admin
// credential, and minus every field the schemas mark secret.
import {
  appItemSchema,
  settingsSchema,
  widgetInstanceSchema,
  redactSecrets,
  redactForExport,
  restoreSecrets,
  type AppItem,
  type Config,
  type Integration,
  type Settings,
  type WidgetInstance,
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
// whole — the inbound webhook tokens and the integrations list (#189, #300:
// URLs map internal topology) — plus, per app, the push-check token (#294),
// and per widget instance, a calendar's credentials (#297). stripAuth only
// removes the top-level admin credential; these secrets live inside
// `settings` and the app rows, where they'd otherwise ride along in
// anything serialized from a public surface. readPublicConfig
// (lib/api-auth.ts) applies this so its result is genuinely safe to hand to a
// client component (#157). The server-side consumers that need the real
// values read them separately — the calendar fetcher via getCalendarAuth, the
// alert poller and the monitor snapshot via readConfigInternal-backed
// accessors.
export function stripSecrets<
  T extends {
    settings: Settings;
    apps?: AppItem[];
    widgets?: WidgetInstance[];
    integrations?: Integration[];
  },
>(config: T): T {
  return {
    ...config,
    // Admin-only wholesale (#300): URLs, credentials, even which services run.
    ...(config.integrations ? { integrations: [] } : {}),
    settings: redactSecrets(settingsSchema, config.settings),
    ...(config.apps ? { apps: config.apps.map((a) => redactSecrets(appItemSchema, a)) } : {}),
    ...(config.widgets
      ? { widgets: config.widgets.map((w) => redactSecrets(widgetInstanceSchema, w)) }
      : {}),
  };
}


// The integration fields that are secrets (#300): the whole list is admin-only
// on public surfaces, but a backup keeps the list and loses just these.
const INTEGRATION_SECRETS = ["password", "apiKey"] as const;
const isEnvRef = (v: string) => /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v.trim());

// A config for a backup without secrets (#366): every credential blanked
// (environment references kept), the rest as stored, so the file imports
// cleanly and restoreImportSecrets fills the blanks from the instance.
export function stripExportSecrets<T extends Omit<Config, "auth">>(config: T): T {
  return {
    ...config,
    settings: redactForExport(settingsSchema, config.settings),
    apps: config.apps.map((a) => redactForExport(appItemSchema, a)),
    widgets: config.widgets.map((w) => redactForExport(widgetInstanceSchema, w)),
    integrations: config.integrations.map((i) => ({
      ...i,
      ...Object.fromEntries(INTEGRATION_SECRETS.map((k) => [k, isEnvRef(i[k]) ? i[k] : ""])),
    })),
  };
}

// A backup being restored with every blank secret filled from what the
// instance holds (#366), matched by id, so a secret-less export restores
// without wiping credentials. A file carrying its own secrets keeps them.
export function restoreImportSecrets(incoming: Config, stored: Config): Config {
  return {
    ...incoming,
    settings: restoreSecrets(settingsSchema, incoming.settings, stored.settings),
    apps: incoming.apps.map((a) =>
      restoreSecrets(appItemSchema, a, stored.apps.find((o) => o.id === a.id))
    ),
    widgets: incoming.widgets.map((w) =>
      restoreSecrets(widgetInstanceSchema, w, stored.widgets.find((o) => o.id === w.id))
    ),
    integrations: incoming.integrations.map((i) => {
      const was = stored.integrations.find((o) => o.id === i.id);
      if (!was) return i;
      return {
        ...i,
        ...Object.fromEntries(INTEGRATION_SECRETS.map((k) => [k, i[k] === "" ? was[k] : i[k]])),
      };
    }),
  };
}
