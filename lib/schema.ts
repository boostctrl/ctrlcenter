import { z } from "zod";
import { ACCENT_KEYS } from "./theme";

// z.string().url() accepts any valid URL — including `javascript:`, `data:`,
// and `vbscript:` schemes. App/bookmark URLs are rendered as <a href> on the
// public homepage, so an unsafe scheme would be stored XSS. Restrict to http(s).
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

export const settingsSchema = z.object({
  title: z.string().default("Home"),
  greetingName: z.string().default(""),
  timezone: z.string().default("UTC"),
  accent: z.enum(ACCENT_KEYS).default("violet"),
  // When on, the dashboard polls /api/status to show per-app online/offline
  // dots. Off by default since it makes the server ping every app URL.
  statusChecks: z.boolean().default(false),
  weather: weatherSchema.default(weatherSchema.parse({})),
});

export const appItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  subtitle: z.string().default(""),
  url: httpUrl,
  icon: z.string().default(""),
});

export const bookmarkItemSchema = z.object({
  id: z.string(),
  category: z.string().min(1),
  name: z.string().min(1),
  url: httpUrl,
  icon: z.string().default(""),
});

export const configSchema = z.object({
  settings: settingsSchema.default(settingsSchema.parse({})),
  apps: z.array(appItemSchema).default([]),
  bookmarks: z.array(bookmarkItemSchema).default([]),
});

export type Config = z.infer<typeof configSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type AppItem = z.infer<typeof appItemSchema>;
export type BookmarkItem = z.infer<typeof bookmarkItemSchema>;

// "Create" schemas (POST): required fields are required, everything else is
// genuinely optional and defaults are fine here since we're building a
// brand-new full row, not merging into an existing one.
export const appInputSchema = z.object({
  name: z.string().min(1),
  subtitle: z.string().optional().default(""),
  url: httpUrl,
  icon: z.string().optional().default(""),
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

export const settingsInputSchema = z.object({
  title: z.string().optional(),
  greetingName: z.string().optional(),
  timezone: z.string().optional(),
  accent: z.enum(ACCENT_KEYS).optional(),
  statusChecks: z.boolean().optional(),
  weather: weatherUpdateSchema.optional(),
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;

export const appUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  subtitle: z.string().optional(),
  url: httpUrl.optional(),
  icon: z.string().optional(),
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
