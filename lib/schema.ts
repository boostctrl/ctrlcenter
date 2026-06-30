import { z } from "zod";
import { DESIGN_IDS, SCENE_IDS } from "./theme";
import { FONT_IDS, DEFAULT_FONT } from "./fonts";
import { SEARCH_ENGINE_KEYS, isValidCustomUrl } from "./search";
import { STATUS_RANGE_KEYS, CHECK_TYPE_KEYS } from "./status";

// 6-digit hex color (matches what <input type="color"> produces and the
// client-side theme sanitizers accept).
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a #rrggbb color");

// z.string().url() accepts any valid URL — including `javascript:`, `data:`,
// and `vbscript:` schemes. App/bookmark URLs are rendered as <a href> on the
// public dashboard, so an unsafe scheme would be stored XSS. Restrict to http(s).
const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value.trim()), {
    message: "URL must start with http:// or https://",
  });

// "Stored" schemas (used to read config.yaml): every field has a default so
// a hand-edited or partially-filled YAML file still parses successfully.
export const weatherSchema = z.object({
  enabled: z.boolean().default(true),
  latitude: z.number().default(38.9072),
  longitude: z.number().default(-77.0369),
  units: z.enum(["imperial", "metric"]).default("imperial"),
});

// Stored search config is lenient (so a hand-edited file always parses); the
// custom URL is validated on the admin-input path and at use time instead.
// A `!key` search shortcut → `%s` URL template. Stored leniently (validated on
// the admin path); malformed entries are simply ignored when resolving a query.
export const bangSchema = z.object({
  key: z.string().default(""),
  url: z.string().default(""),
});

export const searchSchema = z.object({
  engine: z.enum(SEARCH_ENGINE_KEYS).default("duckduckgo"),
  customUrl: z.string().default(""),
  bangs: z.array(bangSchema).default([]),
});

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
});
export type AlertEmailConfig = z.infer<typeof alertEmailSchema>;

export const alertsSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(ALERT_TYPES).default("generic"),
  webhookUrl: z.string().default(""),
  // Also notify when a down app comes back up.
  notifyOnRecovery: z.boolean().default(true),
  // Consecutive failed polls before an app is declared down (flap dampening).
  confirmations: z.number().int().min(1).max(10).default(2),
  email: alertEmailSchema.default(alertEmailSchema.parse({})),
});
export type AlertConfig = z.infer<typeof alertsSchema>;

// Agenda widget fed by a published iCal (.ics) URL. Stored leniently; the URL is
// validated on the admin path.
export const calendarSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(""),
  count: z.number().int().min(1).max(20).default(5),
});
export type CalendarConfig = z.infer<typeof calendarSchema>;

// The site-wide default theme. Visitors can override every part of this in
// their own browser (the theme builder / settings page); these values are the
// baseline an un-customized visitor sees. `background`/`foreground` are optional
// custom default colors — when both are set they override the light/dark mode.
export const themeSchema = z.object({
  mode: z.enum(["system", "light", "dark"]).default("system"),
  // Name of the theme pack chosen as the site default (admin Settings). Purely a
  // UI pointer for the picker — the concrete design/scene/colors below are what
  // the layout/PrefsProvider actually apply.
  preset: z.string().optional(),
  // The pack chosen for an independent light-mode default (admin Settings). When
  // unset, light mode follows the dark default's light variant.
  presetLight: z.string().optional(),
  design: z.enum(DESIGN_IDS).default("glass"),
  scene: z.enum(SCENE_IDS).default("aurora"),
  // Default UI font. `.catch` coerces a retired/unknown id back to the default so
  // a hand-edited or downgraded config still parses.
  font: z.enum(FONT_IDS).catch(DEFAULT_FONT).default(DEFAULT_FONT),
  // Optional light-mode design/scene/font. When set, light mode uses a wholly
  // independent look; when omitted it falls back to the dark-mode values above.
  // `.catch` coerces a retired id to undefined so an old config still parses.
  designLight: z.enum(DESIGN_IDS).optional().catch(undefined),
  sceneLight: z.enum(SCENE_IDS).optional().catch(undefined),
  fontLight: z.enum(FONT_IDS).optional().catch(undefined),
  accentFrom: hexColor.default("#a78bfa"),
  accentTo: hexColor.default("#22d3ee"),
  // Optional custom default surface colors. `background`/`foreground` are the
  // dark-mode pair; `backgroundLight`/`foregroundLight` the light-mode pair (the
  // accent above is shared). Set together so the default look reads cohesively
  // in both modes; light falls back to the dark pair if omitted.
  background: hexColor.optional(),
  foreground: hexColor.optional(),
  backgroundLight: hexColor.optional(),
  foregroundLight: hexColor.optional(),
});

export const settingsSchema = z.object({
  title: z.string().default("Home"),
  favicon: z.string().default(""),
  timezone: z.string().default("UTC"),
  theme: themeSchema.default(themeSchema.parse({})),
  // When on, the dashboard polls /api/status to show per-app online/offline
  // dots. Off by default since it makes the server ping every app URL.
  statusChecks: z.boolean().default(false),
  // How often (minutes) the background poller records uptime history while
  // status checks are on.
  statusInterval: z.number().int().min(1).max(60).default(5),
  // Which time range the /status page opens on (1h / 24h / 30d / 90d).
  statusDefaultRange: z.enum(STATUS_RANGE_KEYS).default("d1"),
  // Explicit display order for bookmark categories; categories not listed fall
  // back to first-seen order. Stale names are ignored at render time.
  bookmarkCategoryOrder: z.array(z.string()).default([]),
  search: searchSchema.default(searchSchema.parse({})),
  weather: weatherSchema.default(weatherSchema.parse({})),
  alerts: alertsSchema.default(alertsSchema.parse({})),
  calendar: calendarSchema.default(calendarSchema.parse({})),
});

// `expectStatus` is an optional comma list of HTTP codes/ranges (e.g.
// "200-299, 401") that count as "up" for the status check. Empty = any reachable
// host counts as up (the original behavior).
//
// `checkType` selects how reachability is measured (see CHECK_TYPES). `.catch`
// coerces an unknown value back to "http" so a hand-edited or downgraded config
// still loads. `port` (TCP) and `keyword` (keyword match) are the per-type
// inputs; other types derive their host from `url`.
export const appItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  subtitle: z.string().default(""),
  url: httpUrl,
  icon: z.string().default(""),
  expectStatus: z.string().default(""),
  checkType: z.enum(CHECK_TYPE_KEYS).catch("http").default("http"),
  port: z.number().int().min(1).max(65535).optional(),
  keyword: z.string().default(""),
});

export const bookmarkItemSchema = z.object({
  id: z.string(),
  category: z.string().min(1),
  name: z.string().min(1),
  url: httpUrl,
  icon: z.string().default(""),
});

// Optional stored admin credential (PBKDF2). Empty means "no UI password set"
// — login falls back to the ADMIN_PASSWORD env var. Kept as a top-level key
// (not under settings) so it's never rendered into public pages.
export const authSchema = z.object({
  passwordHash: z.string().default(""),
  passwordSalt: z.string().default(""),
});

// A cohesive set of surface + accent colors (one mode of a theme).
export const colorSetSchema = z.object({
  background: hexColor,
  foreground: hexColor,
  accentFrom: hexColor,
  accentTo: hexColor,
});

// An admin override of a built-in theme pack, matched by `name`. Only edited
// packs are stored; resolveThemePacks() (lib/theme.ts) applies them over the
// built-ins and ignores any stale name. `name` is a plain string (not an enum)
// on purpose, so renaming a built-in in a future version can't make an existing
// config fail to load.
export const themePackSchema = z.object({
  // Stable id pinning this override to a built-in pack (its original name), so the
  // editable `name` below can differ. Optional for back-compat: an override saved
  // before renaming existed has no `key` and is matched by `name` instead.
  key: z.string().optional(),
  name: z.string().min(1),
  // `.catch` so a retired design/scene id (e.g. an old "mesh" override) coerces
  // to the default instead of failing the whole config parse on load.
  design: z.enum(DESIGN_IDS).catch("glass"),
  scene: z.enum(SCENE_IDS).catch("aurora"),
  dark: colorSetSchema,
  light: colorSetSchema,
});

// Admin sends the whole overrides array (PUT /api/themes); it replaces the
// stored `themes` wholesale, so resetting a pack just omits it.
export const themesInputSchema = z.array(themePackSchema);

export const configSchema = z.object({
  settings: settingsSchema.default(settingsSchema.parse({})),
  apps: z.array(appItemSchema).default([]),
  bookmarks: z.array(bookmarkItemSchema).default([]),
  // Admin overrides of the built-in theme packs (edit-and-reset; see
  // resolveThemePacks). Empty = every pack shows its built-in values.
  themes: z.array(themePackSchema).default([]),
  auth: authSchema.default(authSchema.parse({})),
});

// Parse an array, dropping only the items that fail validation instead of
// failing the whole config. A non-array value falls back to an empty list.
function lenientArray<T extends z.ZodTypeAny>(item: T) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((arr) =>
      arr.flatMap((value) => {
        const parsed = item.safeParse(value);
        return parsed.success ? [parsed.data as z.infer<T>] : [];
      })
    );
}

// Resilient variant used only when READING config.yaml from disk: a single
// malformed app/bookmark/theme row is dropped rather than failing the whole load
// (which would 500 every page on a hand-edited file). Import and write still use
// the strict `configSchema` above, so the admin gets clear feedback on a bad
// file instead of silently losing rows. Extends the per-field `.catch()`
// resilience to whole rows.
export const configReadSchema = configSchema.extend({
  apps: lenientArray(appItemSchema),
  bookmarks: lenientArray(bookmarkItemSchema),
  themes: lenientArray(themePackSchema),
});

export type Config = z.infer<typeof configSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type AppItem = z.infer<typeof appItemSchema>;
export type BookmarkItem = z.infer<typeof bookmarkItemSchema>;
export type ThemePackConfig = z.infer<typeof themePackSchema>;

// "Create" schemas (POST): required fields are required, everything else is
// genuinely optional and defaults are fine here since we're building a
// brand-new full row, not merging into an existing one.
export const appInputSchema = z.object({
  name: z.string().min(1),
  subtitle: z.string().optional().default(""),
  url: httpUrl,
  icon: z.string().optional().default(""),
  expectStatus: z.string().optional().default(""),
  checkType: z.enum(CHECK_TYPE_KEYS).optional().default("http"),
  port: z.number().int().min(1).max(65535).optional(),
  keyword: z.string().optional().default(""),
});

export const bookmarkInputSchema = z.object({
  category: z.string().min(1),
  name: z.string().min(1),
  url: httpUrl,
  icon: z.string().optional().default(""),
});

// "Update" schemas (PUT / partial merge): every field is plain-optional with
// NO `.default()`. This matters — chaining `.partial()` off a schema whose
// fields already carry `.default()` doesn't leave omitted fields untouched,
// it immediately substitutes their defaults, which would silently blow away
// existing values during a partial update. Keeping these schemas separate
// and default-free is what makes "only send the fields you're changing" work.
export const weatherUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  units: z.enum(["imperial", "metric"]).optional(),
});

// Admin sends the full search object; reject a "custom" engine without a valid
// http(s) `%s` template so a broken search bar can't be saved.
export const searchUpdateSchema = z
  .object({
    engine: z.enum(SEARCH_ENGINE_KEYS),
    customUrl: z.string(),
    // Lenient on input so a half-typed bang row doesn't block autosave; bad rows
    // are ignored at resolve time.
    bangs: z.array(bangSchema).optional(),
  })
  .refine((s) => s.engine !== "custom" || isValidCustomUrl(s.customUrl), {
    message: "Custom search URL must start with http(s) and contain %s",
    path: ["customUrl"],
  });

// Admin sends the whole alerts object. A webhook URL is optional (alerts stay
// inert until one is set), but when present it must be http(s).
// When email alerts are enabled, a host and from/to address are required; the
// rest stays lenient. Optional in the parent so older clients can omit it.
export const alertEmailUpdateSchema = z
  .object({
    enabled: z.boolean(),
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: z.string(),
    pass: z.string(),
    from: z.string(),
    to: z.string(),
  })
  .refine(
    (e) =>
      !e.enabled ||
      (e.host.trim() !== "" && e.from.trim() !== "" && e.to.trim() !== ""),
    {
      message: "Email alerts need an SMTP host and from/to addresses",
      path: ["host"],
    }
  );

export const alertsUpdateSchema = z
  .object({
    enabled: z.boolean(),
    type: z.enum(ALERT_TYPES),
    webhookUrl: z.string(),
    notifyOnRecovery: z.boolean(),
    confirmations: z.number().int().min(1).max(10),
    email: alertEmailUpdateSchema.optional(),
  })
  .refine(
    (a) => a.webhookUrl.trim() === "" || /^https?:\/\//i.test(a.webhookUrl.trim()),
    { message: "Webhook URL must start with http(s)", path: ["webhookUrl"] }
  );

// Admin sends the whole calendar object. The URL is optional (the widget stays
// off until set) but must be http(s) or webcal when present.
export const calendarUpdateSchema = z
  .object({
    enabled: z.boolean(),
    url: z.string(),
    count: z.number().int().min(1).max(20),
  })
  .refine(
    (c) =>
      c.url.trim() === "" || /^(https?|webcal):\/\//i.test(c.url.trim()),
    { message: "Calendar URL must start with http(s) or webcal", path: ["url"] }
  );

// The admin sends the whole theme object (not a partial), so updateSettings
// replaces it wholesale — that's how clearing the optional custom colors works
// (omit them and they're gone). Required fields keep a saved theme well-formed.
export const themeInputSchema = z.object({
  mode: z.enum(["system", "light", "dark"]),
  preset: z.string().optional(),
  presetLight: z.string().optional(),
  design: z.enum(DESIGN_IDS),
  scene: z.enum(SCENE_IDS),
  font: z.enum(FONT_IDS),
  designLight: z.enum(DESIGN_IDS).optional(),
  sceneLight: z.enum(SCENE_IDS).optional(),
  fontLight: z.enum(FONT_IDS).optional(),
  accentFrom: hexColor,
  accentTo: hexColor,
  background: hexColor.optional(),
  foreground: hexColor.optional(),
  backgroundLight: hexColor.optional(),
  foregroundLight: hexColor.optional(),
});

export const settingsInputSchema = z.object({
  title: z.string().optional(),
  favicon: z.string().optional(),
  timezone: z.string().optional(),
  theme: themeInputSchema.optional(),
  statusChecks: z.boolean().optional(),
  statusInterval: z.number().int().min(1).max(60).optional(),
  statusDefaultRange: z.enum(STATUS_RANGE_KEYS).optional(),
  bookmarkCategoryOrder: z.array(z.string()).optional(),
  search: searchUpdateSchema.optional(),
  weather: weatherUpdateSchema.optional(),
  alerts: alertsUpdateSchema.optional(),
  calendar: calendarUpdateSchema.optional(),
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;

export const appUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  subtitle: z.string().optional(),
  url: httpUrl.optional(),
  icon: z.string().optional(),
  expectStatus: z.string().optional(),
  checkType: z.enum(CHECK_TYPE_KEYS).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  keyword: z.string().optional(),
});

export const bookmarkUpdateSchema = z.object({
  category: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  url: httpUrl.optional(),
  icon: z.string().optional(),
});

// Reorder (PATCH): an ordered list of existing ids.
export const reorderSchema = z.object({
  ids: z.array(z.string()),
});

// Change-password (POST /api/password).
export const passwordChangeSchema = z.object({
  current: z.string(),
  next: z.string().min(8, "New password must be at least 8 characters"),
});
