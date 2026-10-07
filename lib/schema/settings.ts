// The whole `settings` section: stored shape and the admin PUT input.
import { z } from "zod";
import { STATUS_RANGE_KEYS } from "../status";
import { lenientArray } from "./shared";
import { themeSchema, themeInputSchema } from "./theme";
import { searchSchema, searchUpdateSchema } from "./search";
import { alertsSchema, alertsUpdateSchema } from "./alerts";
import { webhooksSchema, webhooksUpdateSchema } from "./webhooks";
import {
  weatherSchema,
  calendarSchema,
  countdownSchema,
  worldClocksSchema,
  systemStatsSchema,
  notesSchema,
  weatherUpdateSchema,
  calendarUpdateSchema,
  notesUpdateSchema,
  countdownUpdateSchema,
  worldClocksUpdateSchema,
  systemStatsUpdateSchema,
} from "./widgets";
import { feedsSchema, feedsUpdateSchema } from "./feeds";
import { integrationsSchema, integrationsUpdateSchema } from "./integrations";
import {
  announcementSchema,
  statusAnnouncementSchema,
  announcementUpdateSchema,
} from "./announcements";
import {
  componentsSchema,
  layoutSchema,
  componentsUpdateSchema,
  layoutUpdateSchema,
} from "./layout";

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
  // When on, the Apps widget splits private apps into their own labeled
  // "Private Applications" group below the public ones. Off by default so
  // existing dashboards keep their interspersed order. Only ever affects the
  // admin's view — guests never receive private apps (readPublicConfig).
  groupPrivateApps: z.boolean().default(false),
  search: searchSchema.default(searchSchema.parse({})),
  weather: weatherSchema.default(weatherSchema.parse({})),
  alerts: alertsSchema.default(alertsSchema.parse({})),
  calendar: calendarSchema.default(calendarSchema.parse({})),
  notes: notesSchema.default(notesSchema.parse({})),
  announcement: announcementSchema.default(announcementSchema.parse({})),
  // Maintenance/upcoming-change notices for the /status page. Lenient like the
  // layout `sections` list (used directly in this shared schema): one malformed
  // hand-edited row is dropped rather than failing the whole settings parse.
  statusAnnouncements: lenientArray(statusAnnouncementSchema).default([]),
  // Feed cards (RSS/Atom/JSON Feed) — a list since 2.1; the pre-2.1 single
  // `feed` object is folded into it by the shape migration.
  feeds: feedsSchema,
  countdown: countdownSchema.default(countdownSchema.parse({})),
  worldClocks: worldClocksSchema.default(worldClocksSchema.parse({})),
  systemStats: systemStatsSchema.default(systemStatsSchema.parse({})),
  integrations: integrationsSchema.default(integrationsSchema.parse({})),
  webhooks: webhooksSchema.default(webhooksSchema.parse({})),
  components: componentsSchema.default(componentsSchema.parse({})),
  layout: layoutSchema.default(layoutSchema.parse({})),
});

export type Settings = z.infer<typeof settingsSchema>;

export const settingsInputSchema = z.object({
  title: z.string().optional(),
  favicon: z.string().optional(),
  timezone: z.string().optional(),
  theme: themeInputSchema.optional(),
  statusChecks: z.boolean().optional(),
  statusInterval: z.number().int().min(1).max(60).optional(),
  statusDefaultRange: z.enum(STATUS_RANGE_KEYS).optional(),
  bookmarkCategoryOrder: z.array(z.string()).optional(),
  groupPrivateApps: z.boolean().optional(),
  search: searchUpdateSchema.optional(),
  weather: weatherUpdateSchema.optional(),
  alerts: alertsUpdateSchema.optional(),
  calendar: calendarUpdateSchema.optional(),
  notes: notesUpdateSchema.optional(),
  announcement: announcementUpdateSchema.optional(),
  // The admin sends the whole list (each entry carries a client-minted id), so
  // updateSettings replaces it wholesale — it flows through `rest` like the
  // other plain settings arrays (e.g. bookmarkCategoryOrder).
  statusAnnouncements: z.array(statusAnnouncementSchema).optional(),
  // The whole feed-cards list, replaced wholesale like statusAnnouncements.
  feeds: feedsUpdateSchema.optional(),
  countdown: countdownUpdateSchema.optional(),
  worldClocks: worldClocksUpdateSchema.optional(),
  systemStats: systemStatsUpdateSchema.optional(),
  integrations: integrationsUpdateSchema.optional(),
  webhooks: webhooksUpdateSchema.optional(),
  components: componentsUpdateSchema.optional(),
  layout: layoutUpdateSchema.optional(),
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;
