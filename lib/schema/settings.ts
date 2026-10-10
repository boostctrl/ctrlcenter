// The whole `settings` section: stored shape and the admin PUT input.
import { z } from "zod";
import { STATUS_RANGE_KEYS } from "../status";
import { lenientArray } from "./shared";
import { mergeRules, secretFields } from "./meta";
import { themeSchema, themeInputSchema, themeScheduleSchema } from "./theme";
import { VISITOR_THEMING_IDS } from "../theme";
import { searchSchema, searchUpdateSchema } from "./search";
import { alertsSchema, alertsUpdateSchema } from "./alerts";
import { webhooksSchema, webhooksUpdateSchema } from "./webhooks";
import { weatherSchema, weatherUpdateSchema } from "./widgets";
import {
  announcementSchema,
  statusAnnouncementSchema,
  announcementUpdateSchema,
  statusAnnouncementsUpdateSchema,
} from "./announcements";
import { layoutSchema, layoutUpdateSchema } from "./layout";

export const settingsSchema = z.object({
  title: z.string().default("Home"),
  favicon: z.string().default(""),
  timezone: z.string().default("UTC"),
  // Replaced whole on save: omitting an optional custom color clears it.
  theme: themeSchema.default(themeSchema.parse({})).register(mergeRules, { merge: "replace" }),
  // What visitors may change about the theme (#335); admins always may.
  visitorTheming: z.enum(VISITOR_THEMING_IDS).default("all"),
  // A day theme and a night theme by time of day (#336).
  themeSchedule: themeScheduleSchema
    .default(themeScheduleSchema.parse({}))
    .register(mergeRules, { merge: "replace" }),
  // When on, the dashboard polls /api/status to show per-app online/offline
  // dots. Off by default since it makes the server ping every app URL.
  statusChecks: z.boolean().default(false),
  // How often (minutes) the background poller records uptime history while
  // status checks are on.
  statusInterval: z.number().int().min(1).max(60).default(5),
  // Which time range the /status page opens on (1h / 24h / 30d / 90d).
  statusDefaultRange: z.enum(STATUS_RANGE_KEYS).default("d1"),
  search: searchSchema.default(searchSchema.parse({})),
  weather: weatherSchema.default(weatherSchema.parse({})),
  alerts: alertsSchema.default(alertsSchema.parse({})),
  announcement: announcementSchema.default(announcementSchema.parse({})),
  // Maintenance/upcoming-change notices for the /status page. Lenient like a
  // board's layout rows (used directly in this shared schema): one malformed
  // hand-edited row is dropped rather than failing the whole settings parse.
  statusAnnouncements: lenientArray(statusAnnouncementSchema).default([]),
  // Inbound-webhook tokens are shared secrets (#204), private wholesale.
  webhooks: webhooksSchema
    .default(webhooksSchema.parse({}))
    .register(secretFields, { redact: "all" }),
  // The floating corner menu (Weather, Status, Help, Settings…). Was
  // `components.settingsButton` before 3.0.
  settingsButton: z.boolean().default(true),
  // The UI scale and grid spacing, shared by every board (#298).
  layout: layoutSchema.default(layoutSchema.parse({})),
  // The first-run setup (#304) has been finished or skipped. A fresh install
  // starts without it; an upgraded 2.x install had it set by the migration.
  setupComplete: z.boolean().default(false),
});

export type Settings = z.infer<typeof settingsSchema>;

export const settingsInputSchema = z.object({
  title: z.string().optional(),
  favicon: z.string().optional(),
  timezone: z.string().optional(),
  theme: themeInputSchema.optional(),
  visitorTheming: z.enum(VISITOR_THEMING_IDS).optional(),
  themeSchedule: themeScheduleSchema.optional(),
  statusChecks: z.boolean().optional(),
  statusInterval: z.number().int().min(1).max(60).optional(),
  statusDefaultRange: z.enum(STATUS_RANGE_KEYS).optional(),
  search: searchUpdateSchema.optional(),
  weather: weatherUpdateSchema.optional(),
  alerts: alertsUpdateSchema.optional(),
  announcement: announcementUpdateSchema.optional(),
  // The admin sends the whole list (each entry carries a client-minted id), so
  // updateSettings replaces it wholesale — it flows through `rest` like the
  // other plain settings arrays.
  statusAnnouncements: statusAnnouncementsUpdateSchema.optional(),
  webhooks: webhooksUpdateSchema.optional(),
  settingsButton: z.boolean().optional(),
  layout: layoutUpdateSchema.optional(),
  setupComplete: z.boolean().optional(),
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;
