// Home-page component visibility and widget-grid layout.
import { z } from "zod";
import {
  LAYOUT_WIDGET_IDS,
  DEFAULT_WIDGETS,
  GRID_COLUMNS,
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
} from "../layout";
import { lenientArray } from "./shared";

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

// Home-page widget arrangement: an ordered list of widgets, each with a column
// span on the 24-column grid, a hidden flag, and (for the card-grid widgets) an
// optional cards-per-row override. Pre-2.0 shapes (`width` enums, `spaceBelow`,
// 12-column spans) are rewritten by the one-time shape migration before this
// schema ever sees them (lib/config-migrate.ts, ledger #152). `hidden`
// deliberately stays absent (not defaulted) when a stored entry omits it, so
// resolveLayoutWidgets (lib/layout.ts) can fold the legacy components
// visibility toggles in; that resolver also rebuilds whatever this lenient
// per-row parse drops.
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
    // Multi-instance widgets (feed) carry the config instance they render;
    // resolveLayoutWidgets validates it against the live instance ids and drops
    // an orphan, so a bad/stale value here is caught downstream, not at parse.
    instanceId: z.string().optional().catch(undefined),
    span: z.number().int().min(1).max(GRID_COLUMNS).optional().catch(undefined),
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
  })
  .transform(
    ({
      id,
      instanceId,
      span,
      hidden,
      cards,
      hideLabel,
      height,
      space,
    }): {
      id: LayoutWidgetId;
      instanceId?: string;
      span: number;
      hidden?: boolean;
      cards?: number;
      hideLabel?: boolean;
      height?: number;
      space?: WidgetSpace;
    } => {
      const resolvedSpace = cleanSpace(space);
      return {
        id,
        ...(instanceId === undefined ? {} : { instanceId }),
        span: span ?? defaultSpanFor(id),
        ...(hidden === undefined ? {} : { hidden }),
        ...(cards === undefined ? {} : { cards }),
        ...(hideLabel === undefined ? {} : { hideLabel }),
        ...(height === undefined ? {} : { height }),
        ...(resolvedSpace ? { space: resolvedSpace } : {}),
      };
    }
  );

export const layoutSchema = z.object({
  sections: lenientArray(layoutWidgetSchema).default(DEFAULT_WIDGETS),
  // Which grid the stored spans are for. Always 24 today — the one-time shape
  // migration doubles 12-column spans and stamps this marker; keeping it
  // persisted is what tells that migration a file is already current.
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
});
export type LayoutConfig = z.infer<typeof layoutSchema>;

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
      // Multi-instance widgets (feed) bind to their config instance by this id.
      // It MUST round-trip through a save: without it the stored feed entry
      // becomes id-less, and resolveLayoutWidgets then drops it and re-appends
      // the card hidden — a placed RSS card silently vanishing after any
      // settings save (the read schema, layoutWidgetSchema, keeps it too).
      instanceId: z.string().optional(),
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
