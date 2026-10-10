// Apps and bookmarks: stored rows, create/update inputs, and reorder. Both
// belong to groups (#299, lib/schema/groups.ts) by id; forms name a group by
// its name (groupName), and the server resolves or creates it.
import { z } from "zod";
import { CHECK_TYPE_KEYS } from "../status";
import { httpUrl } from "./shared";
import { parseJsonQuery } from "../json-query";
import { secretFields } from "./meta";
import { cleanTags, groupNameInput, tagsInput } from "./groups";

// A JSON query must parse (#294); an empty one is allowed while editing, and
// fails the check until it's filled in.
const jsonQuery = z.string().refine((q) => q.trim() === "" || !("error" in parseJsonQuery(q)), {
  message: "That JSON query doesn't parse — e.g. $.status == \"ok\"",
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
  // The JSON query check's expression (#294), e.g. `$.status == "ok"`.
  jsonQuery: z.string().catch("").default(""),
  // Warn this many days before the TLS certificate expires (#294). The TLS
  // check always warns (default 14); on an https HTTP, keyword or JSON check,
  // setting it adds the certificate watch alongside.
  certWarnDays: z.number().int().min(1).max(365).optional().catch(undefined),
  // The push check's secret (#294): its URL is /api/push/<token>. Generated
  // server-side when the app is switched to push, never taken from input, and
  // redacted from public reads like any credential.
  pushToken: z
    .string()
    .catch("")
    .default("")
    .register(secretFields, { redact: "blank" }),
  // Whether this app gets status checks at all (#296). Off = no dot, no
  // status-page row, no alerts; its history is kept for when it's back on.
  monitor: z.boolean().catch(true).default(true),
  // Per-app check overrides (#292); absent = the global setting. `interval`
  // (minutes) replaces the global status interval, `timeout` (seconds) the
  // 5-second default, and `retries` re-attempts a failed check that many times
  // within one poll before it counts as down. Out-of-range hand edits drop
  // back to the global value rather than failing the load.
  interval: z.number().int().min(1).max(60).optional().catch(undefined),
  timeout: z.number().int().min(1).max(60).optional().catch(undefined),
  retries: z.number().int().min(0).max(5).optional().catch(undefined),
  // Render only for the admin session; readPublicConfig() (lib/api-auth.ts)
  // filters flagged items out of every public surface. Monitoring and alerts
  // ignore the flag.
  private: z.boolean().catch(false).default(false),
  // The group it belongs to (#299), by id; "" for none.
  group: z.string().catch("").default(""),
  // Free-text labels an apps widget can filter on (#299).
  tags: z.array(z.unknown()).catch([]).default([]).transform(cleanTags),
});

export const bookmarkItemSchema = z.object({
  id: z.string(),
  // The group it's listed under (#299), by id. Was the free-text `category`
  // before 3.0 (the migration turns categories into groups).
  group: z.string().catch("").default(""),
  name: z.string().min(1),
  url: httpUrl,
  icon: z.string().default(""),
  // Render only for the admin session, same contract as the app flag above.
  private: z.boolean().catch(false).default(false),
});

export type AppItem = z.infer<typeof appItemSchema>;

// The apps that get status checks (#296): every list a check, a status dot
// or a status-page row comes from goes through this.
export function monitoredApps<T extends { monitor?: boolean }>(apps: T[]): T[] {
  return apps.filter((a) => a.monitor !== false);
}
export type BookmarkItem = z.infer<typeof bookmarkItemSchema>;

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
  jsonQuery: jsonQuery.optional().default(""),
  certWarnDays: z.number().int().min(1).max(365).optional(),
  monitor: z.boolean().optional().default(true),
  interval: z.number().int().min(1).max(60).optional(),
  timeout: z.number().int().min(1).max(60).optional(),
  retries: z.number().int().min(0).max(5).optional(),
  private: z.boolean().optional().default(false),
  groupName: groupNameInput.optional().default(""),
  tags: tagsInput.optional().default([]),
});

export const bookmarkInputSchema = z.object({
  groupName: groupNameInput.min(1),
  name: z.string().min(1),
  url: httpUrl,
  icon: z.string().optional().default(""),
  private: z.boolean().optional().default(false),
});

export const appUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  subtitle: z.string().optional(),
  url: httpUrl.optional(),
  icon: z.string().optional(),
  expectStatus: z.string().optional(),
  checkType: z.enum(CHECK_TYPE_KEYS).optional(),
  // null clears an optional setting back to its default (an omitted field
  // keeps the stored value, since updates merge).
  port: z.number().int().min(1).max(65535).nullable().optional(),
  keyword: z.string().optional(),
  jsonQuery: jsonQuery.optional(),
  certWarnDays: z.number().int().min(1).max(365).nullable().optional(),
  monitor: z.boolean().optional(),
  interval: z.number().int().min(1).max(60).nullable().optional(),
  timeout: z.number().int().min(1).max(60).nullable().optional(),
  retries: z.number().int().min(0).max(5).nullable().optional(),
  private: z.boolean().optional(),
  groupName: groupNameInput.optional(),
  tags: tagsInput.optional(),
});

export const bookmarkUpdateSchema = z.object({
  groupName: groupNameInput.min(1).optional(),
  name: z.string().min(1).optional(),
  url: httpUrl.optional(),
  icon: z.string().optional(),
  private: z.boolean().optional(),
});

// Undo a delete (#307): put the deleted row back whole — same id, so status
// history, outage notes and visitors' favorites still match — at the index it
// was removed from.
export const appRestoreSchema = z.object({
  item: appItemSchema,
  index: z.number().int().min(0),
});

export const bookmarkRestoreSchema = z.object({
  item: bookmarkItemSchema,
  index: z.number().int().min(0),
});

// Bulk-assign apps (#299): move the listed apps to a group ("" for none)
// and/or add tags to each.
export const appsBulkSchema = z
  .object({
    ids: z.array(z.string()).min(1).max(500),
    groupName: groupNameInput.optional(),
    addTags: tagsInput.optional(),
  })
  .refine((v) => v.groupName !== undefined || (v.addTags?.length ?? 0) > 0, {
    message: "Nothing to change",
  });

// Reorder (PATCH): an ordered list of existing ids.
export const reorderSchema = z.object({
  ids: z.array(z.string()),
});
