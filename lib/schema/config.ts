// The top-level config.yaml document (strict and lenient-read variants).
import { z } from "zod";
import { lenientArray } from "./shared";
import { settingsSchema } from "./settings";
import { appItemSchema, bookmarkItemSchema } from "./apps-bookmarks";
import { themeEntrySchema } from "./theme";
import { authSchema } from "./auth";
import { widgetInstancesSchema } from "./instances";
import { boardsSchema } from "./boards";
import { groupsSchema } from "./groups";
import { integrationsSchema } from "./integrations";

// The on-disk config shape's version, written on every save. Files without it
// predate the field (2.9 and earlier). lib/config-migrate.ts keys its
// migration chain on this (#288): the frozen pre-2.x step still detects by
// shape for files stamped ≤ 2, each later shape change bumps this with its own
// step, and a file stamped higher than this build knows is refused.
export const CONFIG_SCHEMA_VERSION = 3;

export const configSchema = z.object({
  schemaVersion: z.number().int().default(CONFIG_SCHEMA_VERSION),
  settings: settingsSchema.default(settingsSchema.parse({})),
  // The dashboards (#298), in order: the first is the home page. Each places
  // widget instances by id.
  boards: boardsSchema,
  // Every widget instance, with its content (#297). Shared by the boards.
  widgets: widgetInstancesSchema,
  // Connections to self-hosted services for the private Monitor page (#300).
  // Admin-only: readPublicConfig drops them.
  integrations: integrationsSchema,
  // The groups apps and bookmarks belong to (#299), in display order.
  groups: groupsSchema,
  apps: z.array(appItemSchema).default([]),
  bookmarks: z.array(bookmarkItemSchema).default([]),
  // The theme gallery (#334): the built-in packs as shipped or edited, hidden
  // or reordered, and the admin's own (see resolveThemeGallery). Empty = the
  // built-ins as shipped.
  themes: z.array(themeEntrySchema).default([]),
  auth: authSchema.default(authSchema.parse({})),
});

// Resilient variant used only when READING config.yaml from disk: a single
// malformed app/bookmark/theme row is dropped rather than failing the whole load
// (which would 500 every page on a hand-edited file). Import and write still use
// the strict `configSchema` above, so the admin gets clear feedback on a bad
// file instead of silently losing rows. Extends the per-field `.catch()`
// resilience to whole rows.
export const configReadSchema = configSchema.extend({
  apps: lenientArray(appItemSchema),
  bookmarks: lenientArray(bookmarkItemSchema),
  themes: lenientArray(themeEntrySchema),
});

export type Config = z.infer<typeof configSchema>;
