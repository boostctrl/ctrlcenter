import { z } from "zod";
import { DESIGN_IDS, SCENE_IDS } from "./theme";
import { SEARCH_ENGINE_KEYS, isValidCustomUrl } from "./search";

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
export const searchSchema = z.object({
  engine: z.enum(SEARCH_ENGINE_KEYS).default("duckduckgo"),
  customUrl: z.string().default(""),
});

// The site-wide default theme. Visitors can override every part of this in
// their own browser (the theme builder / settings page); these values are the
// baseline an un-customized visitor sees. `background`/`foreground` are optional
// custom default colors — when both are set they override the light/dark mode.
export const themeSchema = z.object({
  mode: z.enum(["system", "light", "dark"]).default("system"),
  design: z.enum(DESIGN_IDS).default("glass"),
  scene: z.enum(SCENE_IDS).default("aurora"),
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
  // Explicit display order for bookmark categories; categories not listed fall
  // back to first-seen order. Stale names are ignored at render time.
  bookmarkCategoryOrder: z.array(z.string()).default([]),
  search: searchSchema.default(searchSchema.parse({})),
  weather: weatherSchema.default(weatherSchema.parse({})),
});

// `expectStatus` is an optional comma list of HTTP codes/ranges (e.g.
// "200-299, 401") that count as "up" for the status check. Empty = any reachable
// host counts as up (the original behavior).
export const appItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  subtitle: z.string().default(""),
  url: httpUrl,
  icon: z.string().default(""),
  expectStatus: z.string().default(""),
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
  })
  .refine((s) => s.engine !== "custom" || isValidCustomUrl(s.customUrl), {
    message: "Custom search URL must start with http(s) and contain %s",
    path: ["customUrl"],
  });

// The admin sends the whole theme object (not a partial), so updateSettings
// replaces it wholesale — that's how clearing the optional custom colors works
// (omit them and they're gone). Required fields keep a saved theme well-formed.
export const themeInputSchema = z.object({
  mode: z.enum(["system", "light", "dark"]),
  design: z.enum(DESIGN_IDS),
  scene: z.enum(SCENE_IDS),
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
  bookmarkCategoryOrder: z.array(z.string()).optional(),
  search: searchUpdateSchema.optional(),
  weather: weatherUpdateSchema.optional(),
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;

export const appUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  subtitle: z.string().optional(),
  url: httpUrl.optional(),
  icon: z.string().optional(),
  expectStatus: z.string().optional(),
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
