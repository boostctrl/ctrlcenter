// The top-level config.yaml document (strict and lenient-read variants).
import { z } from "zod";
import { lenientArray } from "./shared";
import { settingsSchema } from "./settings";
import { appItemSchema, bookmarkItemSchema } from "./apps-bookmarks";
import { themeEntrySchema } from "./theme";
import { authSchema } from "./auth";
import { widgetInstanceSchema, widgetInstancesSchema, widgetInstancesUpdateSchema } from "./instances";
import { boardSchema, boardsSchema, boardsUpdateSchema } from "./boards";
import { groupSchema, groupsSchema, groupsUpdateSchema } from "./groups";
import { integrationSchema, integrationsSchema, integrationsUpdateSchema } from "./integrations";

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
// file instead of silently losing rows — and importListError below covers the
// lists that are lenient even there (#403). Extends the per-field `.catch()`
// resilience to whole rows.
export const configReadSchema = configSchema.extend({
  apps: lenientArray(appItemSchema),
  bookmarks: lenientArray(bookmarkItemSchema),
  themes: lenientArray(themeEntrySchema),
});

export type Config = z.infer<typeof configSchema>;

// The lists `configSchema` itself reads leniently, and the rules an import
// holds them to (#403). boards, widgets, groups and integrations are stored
// that way — a row that won't parse is dropped, a repeated id keeps its first
// row, a list past its cap is cut — which suits a hand-edited file on disk
// and not a restore: the admin chose this file, so a row it would lose is
// refused with the reason, and so is a list past an input cap (one the admin
// paths enforce but the stored read doesn't, like MAX_FEED_CARDS; stored
// anyway, nothing more of that kind can be added until some are deleted,
// #426).
// Each row is parsed with its stored item schema (so a 2.x file's migrated
// rows, which leave most fields to their defaults, pass) and the whole list
// is then held to the input list schema's rules.
const IMPORT_LISTS = [
  { key: "boards", label: "board", item: boardSchema, list: boardsUpdateSchema },
  { key: "widgets", label: "widget", item: widgetInstanceSchema, list: widgetInstancesUpdateSchema },
  { key: "groups", label: "group", item: groupSchema, list: groupsUpdateSchema },
  { key: "integrations", label: "integration", item: integrationSchema, list: integrationsUpdateSchema },
] as const;

type Issue = z.core.$ZodIssue;
// An issue as a clause: the field it's on (from `depth` into its path), then
// zod's message; a custom message says it all on its own.
const clause = (issue: Issue, depth: number): string => {
  const field = issue.path.slice(depth).join(".");
  return field && issue.code !== "custom" ? `${field}: ${issue.message}` : issue.message;
};

// The first problem with those lists in a (migrated) config file, as a
// sentence for the admin, or null when it has none.
export function importListError(raw: unknown): string | null {
  const file = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  for (const { key, label, item, list } of IMPORT_LISTS) {
    const rows = file[key];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) return `"${key}" in that file isn't a list.`;
    // An empty list reads as the stock one (boards) or nothing; fine.
    if (rows.length === 0) continue;
    const name = (i: number) => {
      const row = rows[i];
      const id = typeof row === "object" && row !== null ? (row as { id?: unknown }).id : undefined;
      return typeof id === "string" && id ? `${label} "${id}"` : `${label} at position ${i + 1}`;
    };
    const items: unknown[] = [];
    for (let i = 0; i < rows.length; i++) {
      const parsed = item.safeParse(rows[i]);
      if (!parsed.success) return `The ${name(i)} in that file isn't valid: ${clause(parsed.error.issues[0], 0)}.`;
      items.push(parsed.data);
    }
    const checked = list.safeParse(items);
    if (checked.success) continue;
    const issue = checked.error.issues[0];
    const at = issue.path[0];
    if (typeof at === "number") return `The ${name(at)} in that file isn't valid: ${clause(issue, 1)}.`;
    if (issue.code === "too_big") {
      return `That file has ${rows.length} ${label}s; CtrlCenter holds at most ${issue.maximum}.`;
    }
    return `That file has more ${label}s of one kind than CtrlCenter holds: ${issue.message}.`;
  }
  return null;
}
