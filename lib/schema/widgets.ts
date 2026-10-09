// Single-instance home-page widget settings: weather, calendar, countdown,
// world clocks, system stats, and notes.
import { z } from "zod";
import { secretFields } from "./meta";
import { patchOf, wholeOf } from "./input";

export const weatherSchema = z.object({
  enabled: z.boolean().default(true),
  latitude: z.number().default(38.9072),
  longitude: z.number().default(-77.0369),
  units: z.enum(["imperial", "metric"]).default("imperial"),
});

// Agenda widget fed by a published iCal (.ics) URL. Stored leniently; the URL is
// validated on the admin path.
export const calendarSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(""),
  count: z.number().int().min(1).max(20).default(5),
  // The home-page widget's default view: the upcoming-events agenda (default) or a
  // compact month grid that links through to /calendar. The /calendar page itself
  // defaults to the month view regardless.
  homeView: z.enum(["agenda", "month"]).default("agenda"),
  // Hide the home-page card entirely when there are no events to show (instead of
  // an empty "No upcoming events" card). The dedicated /calendar page still
  // renders its own state.
  hideWhenEmpty: z.boolean().default(false),
  // Optional Basic-auth credentials for a private CalDAV/WebDAV calendar (e.g. a
  // Nextcloud DAV URL). The password can also come from CTRLCENTER_CALDAV_PASS.
  username: z.string().default("").register(secretFields, { redact: "blank" }),
  password: z.string().default("").register(secretFields, { redact: "blank" }),
});
export type CalendarConfig = z.infer<typeof calendarSchema>;

// Countdown widget: labeled dates rendered as "in N days" rows. Stored
// leniently (a half-typed row never fails the config load); rows without a
// valid YYYY-MM-DD date are ignored at render time.
//
// The date keeps a preprocess from the js-yaml 4 days, when an unquoted
// `date: 2026-09-01` in a hand-edited file parsed as a JS Date and a plain
// z.string() would fail the WHOLE config load. js-yaml 5's core schema keeps
// it a string, but a Date from any other source still folds back to the
// calendar date (UTC midnight, so the ISO slice is that same date); anything
// else non-string degrades to an empty date rather than an error.
export const countdownItemSchema = z.object({
  label: z.string().default(""),
  date: z.preprocess(
    (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
    z.string().catch("").default("")
  ),
});
export const countdownSchema = z.object({
  title: z.string().default("Countdown"),
  items: z.array(countdownItemSchema).default([]),
});
export type CountdownConfig = z.infer<typeof countdownSchema>;

// World-clocks widget: labeled IANA time zones rendered as live clocks. Stored
// leniently (a half-typed row never fails the config load); rows without a
// valid time zone are ignored at render time (lib/datetime isValidTimeZone).
export const worldClockItemSchema = z.object({
  label: z.string().default(""),
  timeZone: z.string().default(""),
});
export const worldClocksSchema = z.object({
  title: z.string().default("World clocks"),
  items: z.array(worldClockItemSchema).default([]),
});
export type WorldClocksConfig = z.infer<typeof worldClocksSchema>;

// Cap on admin-configured extra disk rows for the System Stats widget (the
// default data-dir row rides on top). Each is one statfs per render — bounded
// like MAX_FEED_URLS, a guard against a hand-edited config fanning the
// collector out. Lives here (not lib/system-stats.ts) because the collector
// imports lib/config, which imports this file — the constant would cycle.
export const MAX_STAT_DISKS = 8;

// System Stats widget: CPU / memory / disk usage of the machine (or container)
// running the app. The metrics themselves come from lib/system-stats.ts at
// render time; the config carries only the card title and the admin's extra
// disk rows (the data volume is always shown). Stored leniently (a half-typed
// row never fails the config load); rows with a blank path are skipped at
// collection time, and unmountable paths are skipped per-row.
export const systemStatsDiskSchema = z.object({
  label: z.string().default(""),
  path: z.string().default(""),
});
export const systemStatsSchema = z.object({
  title: z.string().default("System stats"),
  disks: z.array(systemStatsDiskSchema).default([]),
});
export type SystemStatsConfig = z.infer<typeof systemStatsSchema>;

// The Notes widget's content: a title and a markdown body (safe subset,
// rendered by lib/markdown.ts — never as raw HTML). No `enabled` flag: the
// widget's layout `hidden` flag governs visibility, and an empty body renders
// nothing. Stored leniently so a hand-edited file always parses.
export const notesSchema = z.object({
  title: z.string().default("Notes"),
  content: z.string().default(""),
});
export type NotesConfig = z.infer<typeof notesSchema>;

// Admin input, derived from the stored schemas above (lib/schema/input.ts).
// Each is a patch: the settings PUT deep-merges it, so only sent keys change.

// Coordinates are bounded on input; the stored schema stays lenient.
export const weatherUpdateSchema = patchOf(weatherSchema).extend({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

// The URL is optional (the widget stays off until set) but must be http(s) or
// webcal when present.
export const calendarUpdateSchema = patchOf(calendarSchema).refine(
  (c) => c.url === undefined || c.url.trim() === "" || /^(https?|webcal):\/\//i.test(c.url.trim()),
  { message: "Calendar URL must start with http(s) or webcal", path: ["url"] }
);

export const notesUpdateSchema = patchOf(notesSchema);

// Rows stay lenient in content (a half-typed date or zone must not block
// autosave; invalid ones simply aren't rendered).
export const countdownUpdateSchema = patchOf(countdownSchema);
export const worldClocksUpdateSchema = patchOf(worldClocksSchema);

// Disk rows are capped on input — each is a per-render statfs.
export const systemStatsUpdateSchema = patchOf(systemStatsSchema).extend({
  disks: z.array(wholeOf(systemStatsDiskSchema)).max(MAX_STAT_DISKS).optional(),
});
