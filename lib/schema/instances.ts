// Widget instances (#297, 3.0): every widget on a board is an instance in the
// top-level `widgets` list, carrying its own content. Layout sections refer to
// one by `widget: <id>`, so a type can appear any number of times: two notes
// cards, three calendars, a feed per topic. The type's facts (label, default
// span, capabilities) stay in lib/widgets/defs.ts; this file is the stored
// shape of each type's content.
import { z } from "zod";
import { lenientArray } from "./shared";
import { wholeOf } from "./input";
import {
  calendarSchema,
  countdownSchema,
  notesSchema,
  systemStatsDiskSchema,
  systemStatsSchema,
  worldClocksSchema,
  MAX_STAT_DISKS,
} from "./widgets";
import { feedSchema, MAX_FEED_CARDS, MAX_FEED_URLS } from "./feeds";

// Instance ids are what layout sections, URLs and the editor key on: short,
// and safe to put in a URL path segment.
const instanceId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

const base = { id: instanceId };

// The header card's own switch for its date/time row (was the site-wide
// `settings.components.clock` before 3.0).
const headerCardContent = { showClock: z.boolean().catch(true).default(true) };

export const widgetInstanceSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("greeting") }),
  z.object({ ...base, type: z.literal("headerCard"), ...headerCardContent }),
  z.object({ ...base, type: z.literal("clock") }),
  z.object({ ...base, type: z.literal("weather") }),
  z.object({ ...base, type: z.literal("status") }),
  z.object({ ...base, type: z.literal("search") }),
  z.object({ ...base, type: z.literal("calendar"), ...calendarSchema.shape }),
  z.object({ ...base, type: z.literal("notes"), ...notesSchema.shape }),
  z.object({ ...base, type: z.literal("feed"), ...feedSchema.shape }),
  z.object({ ...base, type: z.literal("countdown"), ...countdownSchema.shape }),
  z.object({ ...base, type: z.literal("worldClocks"), ...worldClocksSchema.shape }),
  z.object({ ...base, type: z.literal("systemStats"), ...systemStatsSchema.shape }),
  z.object({ ...base, type: z.literal("favorites") }),
  z.object({ ...base, type: z.literal("apps") }),
  z.object({ ...base, type: z.literal("bookmarks") }),
]);
export type WidgetInstance = z.infer<typeof widgetInstanceSchema>;
export type WidgetInstanceType = WidgetInstance["type"];
export type InstanceOf<T extends WidgetInstanceType> = Extract<WidgetInstance, { type: T }>;

// A fresh instance of `type` with every content default filled in.
export function newInstance<T extends WidgetInstanceType>(type: T, id: string): InstanceOf<T> {
  return widgetInstanceSchema.parse({ id, type }) as InstanceOf<T>;
}

// The stock set: one instance of every type, its id the type name, which is
// what a v2 config migrates to as well (lib/config-migrate.ts).
export const DEFAULT_INSTANCES: WidgetInstance[] = (
  [
    "greeting",
    "headerCard",
    "clock",
    "weather",
    "status",
    "search",
    "calendar",
    "notes",
    "feed",
    "countdown",
    "worldClocks",
    "systemStats",
    "favorites",
    "apps",
    "bookmarks",
  ] as const
).map((type) => newInstance(type, type));

// Stored leniently: an instance of an unknown type, or one that won't parse,
// is dropped rather than failing the whole config.
export const widgetInstancesSchema = lenientArray(widgetInstanceSchema).default(DEFAULT_INSTANCES);

// How many instances a config can hold, and how many feed cards: each feed is
// MAX_FEED_URLS fetches per render, so the fan-out stays bounded.
export const MAX_WIDGET_INSTANCES = 64;

const httpOrBlank = (u: string) => u.trim() === "" || /^https?:\/\//i.test(u.trim());

// Admin input (PUT /api/widgets): the whole list, each instance complete, with
// the input-only rules the stored shape can't state.
export const widgetInstancesUpdateSchema = z
  .array(wholeOf(widgetInstanceSchema))
  .max(MAX_WIDGET_INSTANCES)
  .superRefine((list, ctx) => {
    const ids = new Set<string>();
    let feeds = 0;
    list.forEach((w, i) => {
      if (ids.has(w.id)) ctx.addIssue({ code: "custom", message: "Duplicate widget id", path: [i, "id"] });
      ids.add(w.id);
      if (w.type === "feed") {
        feeds++;
        if (w.urls.length > MAX_FEED_URLS)
          ctx.addIssue({ code: "custom", message: "Too many feed URLs", path: [i, "urls"] });
        if (!w.urls.every(httpOrBlank))
          ctx.addIssue({ code: "custom", message: "Every feed URL must start with http(s)", path: [i, "urls"] });
      }
      if (w.type === "calendar" && !(w.url.trim() === "" || /^(https?|webcal):\/\//i.test(w.url.trim())))
        ctx.addIssue({ code: "custom", message: "Calendar URL must start with http(s) or webcal", path: [i, "url"] });
      if (w.type === "systemStats" && w.disks.length > MAX_STAT_DISKS)
        ctx.addIssue({ code: "custom", message: "Too many disks", path: [i, "disks"] });
    });
    if (feeds > MAX_FEED_CARDS)
      ctx.addIssue({ code: "custom", message: `At most ${MAX_FEED_CARDS} RSS feed cards` });
  });

// Re-exported for the editors that build rows.
export { systemStatsDiskSchema };
