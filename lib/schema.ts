import { z } from "zod";
import { DESIGN_IDS, SCENE_IDS } from "./theme";
import { FONT_IDS, DEFAULT_FONT } from "./fonts";
import { SEARCH_ENGINE_KEYS, isValidCustomUrl } from "./search";
import { STATUS_RANGE_KEYS, CHECK_TYPE_KEYS } from "./status";
import {
  LAYOUT_WIDGET_IDS,
  SECTION_WIDTHS,
  WIDTH_TO_SPAN,
  DEFAULT_WIDGETS,
  GRID_COLUMNS,
  LEGACY_GRID_COLUMNS,
  MAX_CARD_COLUMNS,
  MIN_WIDGET_HEIGHT,
  MAX_WIDGET_HEIGHT,
  MAX_WIDGET_SPACE,
  MIN_GRID_GAP,
  MAX_GRID_GAP,
  DEFAULT_GRID_GAP,
  MIN_TOP_GAP,
  MAX_TOP_GAP,
  DEFAULT_TOP_GAP,
  MIN_UI_SCALE,
  MAX_UI_SCALE,
  DEFAULT_UI_SCALE,
  defaultSpanFor,
  type LayoutWidgetId,
  type WidgetSpace,
} from "./layout";

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
  // Subject template; {service} and {status} are substituted. Empty = the
  // default "{service} is {status}".
  subject: z.string().default(""),
});
export type AlertEmailConfig = z.infer<typeof alertEmailSchema>;

export const alertsSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(ALERT_TYPES).default("generic"),
  webhookUrl: z.string().default(""),
  // Webhook channel on/off, independent of the email channel. Defaults true so an
  // existing config with a webhook URL keeps sending; the webhook fires only when
  // this is on AND a URL is set.
  webhookEnabled: z.boolean().default(true),
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
  username: z.string().default(""),
  password: z.string().default(""),
});
export type CalendarConfig = z.infer<typeof calendarSchema>;

// RSS/Atom feed widget fed by a public feed URL. Stored leniently; the URL is
// validated on the admin path.
export const feedSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(""),
  count: z.number().int().min(1).max(15).default(6),
  // Card title override; empty uses the feed's own title.
  title: z.string().default(""),
});
export type FeedConfig = z.infer<typeof feedSchema>;

// Countdown widget: labeled dates rendered as "in N days" rows. Stored
// leniently (a half-typed row never fails the config load); rows without a
// valid YYYY-MM-DD date are ignored at render time.
export const countdownItemSchema = z.object({
  label: z.string().default(""),
  date: z.string().default(""),
});
export const countdownSchema = z.object({
  title: z.string().default("Countdown"),
  items: z.array(countdownItemSchema).default([]),
});
export type CountdownConfig = z.infer<typeof countdownSchema>;

// The Notes widget's content: a title and a markdown body (safe subset,
// rendered by lib/markdown.ts — never as raw HTML). No `enabled` flag: the
// widget's layout `hidden` flag governs visibility, and an empty body renders
// nothing. Stored leniently so a hand-edited file always parses.
export const notesSchema = z.object({
  title: z.string().default("Notes"),
  content: z.string().default(""),
});
export type NotesConfig = z.infer<typeof notesSchema>;

// Site-wide announcement banner shown at the top of every page. The banner
// renders only when `enabled` and `message` is non-empty (see
// AnnouncementBanner). `message` is a safe inline-markdown subset (bold/italic/
// links) rendered as React elements — never raw HTML. `tone` colors the strip;
// `dismissible` adds a close button (a visitor's dismissal is remembered until
// the message changes). Stored leniently so a hand-edited file always parses.
export const ANNOUNCEMENT_TONES = [
  "info",
  "warning",
  "success",
  "accent",
] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];
export const announcementSchema = z.object({
  enabled: z.boolean().catch(false),
  message: z.string().catch(""),
  tone: z.enum(ANNOUNCEMENT_TONES).catch("accent"),
  dismissible: z.boolean().catch(true),
});
export type AnnouncementConfig = z.infer<typeof announcementSchema>;

// Per-service maintenance/incident notices shown on the /status page — distinct
// from the site-wide `announcement` banner above. Each carries a `kind` that
// tints its card, a title, an inline-markdown `body` (same safe subset as the
// banner), and an optional scheduling window (`startsAt`/`endsAt` as UTC ISO
// instants, empty = unset). A shared helper derives active/scheduled/expired
// from the window (lib/status-announcements.ts). Every field is `.catch`-guarded
// so a hand-edited row coerces per-field; `id` is required, so a row missing it
// is dropped whole by the lenient array below (matching layout `sections`).
export const STATUS_ANNOUNCEMENT_KINDS = [
  "maintenance",
  "incident",
  "info",
] as const;
export type StatusAnnouncementKind = (typeof STATUS_ANNOUNCEMENT_KINDS)[number];
export const statusAnnouncementSchema = z.object({
  id: z.string(),
  title: z.string().catch(""),
  body: z.string().catch(""),
  kind: z.enum(STATUS_ANNOUNCEMENT_KINDS).catch("info"),
  startsAt: z.string().catch(""),
  endsAt: z.string().catch(""),
});
export type StatusAnnouncement = z.infer<typeof statusAnnouncementSchema>;

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
  // `.catch` coerces a retired/unknown id back to the default so a hand-edited
  // or pre-1.4 config (e.g. scene "mesh") still parses instead of 500-ing.
  design: z.enum(DESIGN_IDS).catch("glass").default("glass"),
  scene: z.enum(SCENE_IDS).catch("aurora").default("aurora"),
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

// Per-component visibility for the home page. Each flag defaults on, so existing
// configs keep showing everything. Weather, the status row, and the calendar have
// their own dedicated toggles already, so they aren't duplicated here.
//
// greeting/search/apps/bookmarks/favorites are LEGACY inputs since the widget
// grid: placement visibility lives in layout `hidden` now, and these flags are
// only folded in by resolveLayoutWidgets for layout entries saved before that
// (they're still honored so an old config renders unchanged). `clock` stays
// live — it hides the date/time row inside the header card and gates the
// standalone clock widget's content — as does `settingsButton`.
export const componentsSchema = z.object({
  greeting: z.boolean().default(true),
  clock: z.boolean().default(true),
  search: z.boolean().default(true),
  apps: z.boolean().default(true),
  bookmarks: z.boolean().default(true),
  favorites: z.boolean().default(true),
  settingsButton: z.boolean().default(true),
});
export type ComponentsConfig = z.infer<typeof componentsSchema>;

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

// Home-page widget arrangement: an ordered list of widgets, each with a column
// span on the 24-column grid, a hidden flag, and (for the card-grid widgets) an
// optional cards-per-row override. The legacy pre-1.3 shape
// ({ id, width: full|twoThirds|half|third }) still parses — the transform maps
// a width to its span, and since writeConfig re-parses on every save, a stored
// config migrates to the span shape on its next write (the transform is
// idempotent). `hidden` deliberately stays absent (not defaulted) when a stored
// entry omits it, so resolveLayoutWidgets (lib/layout.ts) can fold the legacy
// components visibility toggles in; that resolver also rebuilds whatever this
// lenient per-row parse drops.
// One side's spacing value (px). Reused by the lenient and strict space schemas.
const spaceSideSchema = z.number().int().min(1).max(MAX_WIDGET_SPACE);
// Per-side extra space around a card. Lenient variant catches a bad side to
// undefined so one stray value can't drop the rest; strict rejects the request.
const lenientSpaceSchema = z.object({
  top: spaceSideSchema.optional().catch(undefined),
  right: spaceSideSchema.optional().catch(undefined),
  bottom: spaceSideSchema.optional().catch(undefined),
  left: spaceSideSchema.optional().catch(undefined),
});
export const widgetSpaceSchema = z.object({
  top: spaceSideSchema.optional(),
  right: spaceSideSchema.optional(),
  bottom: spaceSideSchema.optional(),
  left: spaceSideSchema.optional(),
});

// Drop undefined sides; undefined when nothing valid remains, so an entry with
// no spacing never persists an empty object.
function cleanSpace(space: WidgetSpace | undefined): WidgetSpace | undefined {
  if (!space) return undefined;
  const out: WidgetSpace = {};
  for (const [side, value] of Object.entries(space)) {
    if (typeof value === "number") out[side as keyof WidgetSpace] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export const layoutWidgetSchema = z
  .object({
    id: z.enum(LAYOUT_WIDGET_IDS),
    span: z.number().int().min(1).max(GRID_COLUMNS).optional().catch(undefined),
    width: z.enum(SECTION_WIDTHS).optional().catch(undefined),
    hidden: z.boolean().optional().catch(undefined),
    cards: z
      .number()
      .int()
      .min(1)
      .max(MAX_CARD_COLUMNS)
      .optional()
      .catch(undefined),
    hideLabel: z.boolean().optional().catch(undefined),
    height: z
      .number()
      .int()
      .min(MIN_WIDGET_HEIGHT)
      .max(MAX_WIDGET_HEIGHT)
      .optional()
      .catch(undefined),
    space: lenientSpaceSchema.optional().catch(undefined),
    // Pre-1.8.1 single-sided spacing; migrated into `space.bottom` below.
    spaceBelow: spaceSideSchema.optional().catch(undefined),
  })
  .transform(
    ({
      id,
      span,
      width,
      hidden,
      cards,
      hideLabel,
      height,
      space,
      spaceBelow,
    }): {
      id: LayoutWidgetId;
      span: number;
      hidden?: boolean;
      cards?: number;
      hideLabel?: boolean;
      height?: number;
      space?: WidgetSpace;
    } => {
      // A valid `space` wins; else migrate a legacy `spaceBelow` to the bottom.
      const resolvedSpace =
        cleanSpace(space) ??
        (spaceBelow === undefined ? undefined : { bottom: spaceBelow });
      return {
        id,
        span: span ?? (width ? WIDTH_TO_SPAN[width] : defaultSpanFor(id)),
        ...(hidden === undefined ? {} : { hidden }),
        ...(cards === undefined ? {} : { cards }),
        ...(hideLabel === undefined ? {} : { hideLabel }),
        ...(height === undefined ? {} : { height }),
        ...(resolvedSpace ? { space: resolvedSpace } : {}),
      };
    }
  );

// Spans saved against the 1.3 12-column grid double onto today's 24-column
// one. This must run BEFORE the per-widget parse: that parse fills missing
// spans from legacy widths/defaults which are already 24-based and must not be
// doubled. Only plausible 12-based spans are touched; anything else falls
// through to the per-widget validation. Idempotent because the output layout
// always carries `columns: 24`.
function migrateLayoutColumns(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = raw as { sections?: unknown; columns?: unknown };
  if (obj.columns === GRID_COLUMNS || !Array.isArray(obj.sections)) {
    return { ...obj, columns: GRID_COLUMNS };
  }
  const sections = obj.sections.map((row) => {
    if (typeof row !== "object" || row === null) return row;
    const span = (row as { span?: unknown }).span;
    return typeof span === "number" &&
      Number.isInteger(span) &&
      span >= 1 &&
      span <= LEGACY_GRID_COLUMNS
      ? { ...row, span: span * 2 }
      : row;
  });
  return { ...obj, sections, columns: GRID_COLUMNS };
}

export const layoutSchema = z.preprocess(
  migrateLayoutColumns,
  z.object({
    sections: lenientArray(layoutWidgetSchema).default(DEFAULT_WIDGETS),
    // Which grid the stored spans are for — always 24 after the preprocess;
    // persisting it is what keeps the doubling from re-applying.
    columns: z.literal(GRID_COLUMNS).catch(GRID_COLUMNS).default(GRID_COLUMNS),
    // Site-wide UI scale (percent). Rendered as font-size on <html>, so the
    // whole rem-based UI scales uniformly.
    scale: z
      .number()
      .int()
      .min(MIN_UI_SCALE)
      .max(MAX_UI_SCALE)
      .catch(DEFAULT_UI_SCALE)
      .default(DEFAULT_UI_SCALE),
    // Vertical gap (px) between cards on the grid.
    gap: z
      .number()
      .int()
      .min(MIN_GRID_GAP)
      .max(MAX_GRID_GAP)
      .catch(DEFAULT_GRID_GAP)
      .default(DEFAULT_GRID_GAP),
    // Gap (px) between the top of the page and the first row of widgets.
    // Applied as-is on large screens, capped at the small-screen stock value
    // below them (see smallScreenTopGap in lib/layout.ts).
    topGap: z
      .number()
      .int()
      .min(MIN_TOP_GAP)
      .max(MAX_TOP_GAP)
      .catch(DEFAULT_TOP_GAP)
      .default(DEFAULT_TOP_GAP),
  })
);
export type LayoutConfig = z.infer<typeof layoutSchema>;

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
  notes: notesSchema.default(notesSchema.parse({})),
  announcement: announcementSchema.default(announcementSchema.parse({})),
  // Maintenance/upcoming-change notices for the /status page. Lenient like the
  // layout `sections` list (used directly in this shared schema): one malformed
  // hand-edited row is dropped rather than failing the whole settings parse.
  statusAnnouncements: lenientArray(statusAnnouncementSchema).default([]),
  feed: feedSchema.default(feedSchema.parse({})),
  countdown: countdownSchema.default(countdownSchema.parse({})),
  components: componentsSchema.default(componentsSchema.parse({})),
  layout: layoutSchema.default(layoutSchema.parse({})),
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
  // Render only for the admin session; readPublicConfig() (lib/api-auth.ts)
  // filters flagged items out of every public surface. Monitoring and alerts
  // ignore the flag.
  private: z.boolean().catch(false).default(false),
});

export const bookmarkItemSchema = z.object({
  id: z.string(),
  category: z.string().min(1),
  name: z.string().min(1),
  url: httpUrl,
  icon: z.string().default(""),
  // Render only for the admin session, same contract as the app flag above.
  private: z.boolean().catch(false).default(false),
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
  private: z.boolean().optional().default(false),
});

export const bookmarkInputSchema = z.object({
  category: z.string().min(1),
  name: z.string().min(1),
  url: httpUrl,
  icon: z.string().optional().default(""),
  private: z.boolean().optional().default(false),
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
// Lenient like the webhook URL: an enabled-but-incomplete email channel just
// stays inert (processAlerts gates sending on emailReady), so partially-filled
// fields never block an autosave. The admin UI nudges to finish the config.
// Optional in the parent so older clients can omit it.
export const alertEmailUpdateSchema = z.object({
  enabled: z.boolean(),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  subject: z.string(),
  user: z.string(),
  pass: z.string(),
  from: z.string(),
  to: z.string(),
});

export const alertsUpdateSchema = z
  .object({
    enabled: z.boolean(),
    type: z.enum(ALERT_TYPES),
    webhookUrl: z.string(),
    webhookEnabled: z.boolean().optional(),
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
    homeView: z.enum(["agenda", "month"]),
    hideWhenEmpty: z.boolean(),
    username: z.string(),
    password: z.string(),
  })
  .refine(
    (c) =>
      c.url.trim() === "" || /^(https?|webcal):\/\//i.test(c.url.trim()),
    { message: "Calendar URL must start with http(s) or webcal", path: ["url"] }
  );

// The admin sends the whole notes object (title + content together).
export const notesUpdateSchema = z.object({
  title: z.string(),
  content: z.string(),
});

// The admin sends the whole announcement object.
export const announcementUpdateSchema = z.object({
  enabled: z.boolean(),
  message: z.string(),
  tone: z.enum(ANNOUNCEMENT_TONES),
  dismissible: z.boolean(),
});

// The admin sends the whole countdown object. Rows stay lenient (a half-typed
// date must not block autosave); invalid dates are simply not rendered.
export const countdownUpdateSchema = z.object({
  title: z.string(),
  items: z.array(z.object({ label: z.string(), date: z.string() })),
});

// The admin sends the whole feed object. The URL is optional (the widget stays
// inert until set) but must be http(s) when present.
export const feedUpdateSchema = z
  .object({
    enabled: z.boolean(),
    url: z.string(),
    count: z.number().int().min(1).max(15),
    title: z.string(),
  })
  .refine(
    (f) => f.url.trim() === "" || /^https?:\/\//i.test(f.url.trim()),
    { message: "Feed URL must start with http(s)", path: ["url"] }
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

// The admin sends the whole components object (all flags), so updateSettings can
// replace it wholesale.
export const componentsUpdateSchema = z.object({
  greeting: z.boolean(),
  clock: z.boolean(),
  search: z.boolean(),
  apps: z.boolean(),
  bookmarks: z.boolean(),
  favorites: z.boolean(),
  settingsButton: z.boolean(),
});

// The admin/editor sends the whole layout (every widget, fully resolved), so
// updateSettings replaces it wholesale (like theme/components). Spans are on
// the 24-column grid; `columns` is stamped in so the stored layout never
// re-triggers the 12→24 migration.
export const layoutUpdateSchema = z.object({
  sections: z.array(
    z.object({
      id: z.enum(LAYOUT_WIDGET_IDS),
      span: z.number().int().min(1).max(GRID_COLUMNS),
      hidden: z.boolean(),
      cards: z.number().int().min(1).max(MAX_CARD_COLUMNS).optional(),
      hideLabel: z.boolean().optional(),
      height: z
        .number()
        .int()
        .min(MIN_WIDGET_HEIGHT)
        .max(MAX_WIDGET_HEIGHT)
        .optional(),
      space: widgetSpaceSchema.optional(),
    })
  ),
  columns: z.literal(GRID_COLUMNS).default(GRID_COLUMNS),
  scale: z
    .number()
    .int()
    .min(MIN_UI_SCALE)
    .max(MAX_UI_SCALE)
    .default(DEFAULT_UI_SCALE),
  gap: z
    .number()
    .int()
    .min(MIN_GRID_GAP)
    .max(MAX_GRID_GAP)
    .default(DEFAULT_GRID_GAP),
  topGap: z
    .number()
    .int()
    .min(MIN_TOP_GAP)
    .max(MAX_TOP_GAP)
    .default(DEFAULT_TOP_GAP),
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
  notes: notesUpdateSchema.optional(),
  announcement: announcementUpdateSchema.optional(),
  // The admin sends the whole list (each entry carries a client-minted id), so
  // updateSettings replaces it wholesale — it flows through `rest` like the
  // other plain settings arrays (e.g. bookmarkCategoryOrder).
  statusAnnouncements: z.array(statusAnnouncementSchema).optional(),
  feed: feedUpdateSchema.optional(),
  countdown: countdownUpdateSchema.optional(),
  components: componentsUpdateSchema.optional(),
  layout: layoutUpdateSchema.optional(),
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
  private: z.boolean().optional(),
});

export const bookmarkUpdateSchema = z.object({
  category: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  url: httpUrl.optional(),
  icon: z.string().optional(),
  private: z.boolean().optional(),
});

// Rename a bookmark category across its bookmarks (PATCH /api/bookmarks/category).
// `from` is NOT trimmed — it must match the stored category verbatim, and stored
// names can carry stray whitespace (bookmark input doesn't trim); trimming here
// would make such a category permanently unrenameable. `to` is trimmed and must
// be non-empty after trimming (trim BEFORE the min check, so "   " is rejected
// rather than passing on its untrimmed length). A no-op rename (from === to) is
// rejected as a 400 — the client cancels it before ever calling here, so this
// only guards a direct request.
export const bookmarkCategoryRenameSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().trim().min(1),
  })
  .refine((v) => v.from !== v.to, {
    message: "New category name must differ from the old one",
    path: ["to"],
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
