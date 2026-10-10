// The widget-grid layout: placed widget instances (per board) and the grid's
// spacing (site-wide).
import { z } from "zod";
import {
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
  type WidgetSpace,
} from "../layout";
import { lenientArray } from "./shared";

// A board's widget arrangement: an ordered list of placed widget instances
// (#297), each with a column span on the 24-column grid, a hidden flag, and
// optional per-placement tweaks. Shapes from before 3.0 are rewritten by the
// migration chain (lib/config-migrate.ts) before this schema sees them.
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

// One placed widget on the grid (#297): which instance (`widget`, an id in the
// top-level `widgets` list), its column span, a hidden flag, and the optional
// per-placement tweaks. Every field but the instance is optional and
// lenient; resolveLayout (lib/layout.ts) fills defaults from the instance's
// type and drops a row whose instance no longer exists.
export const layoutSectionSchema = z
  .object({
    widget: z.string().min(1),
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
  .transform(({ space, ...row }) => {
    const resolvedSpace = cleanSpace(space);
    const out = Object.fromEntries(
      Object.entries(row).filter(([, v]) => v !== undefined)
    ) as unknown as Omit<typeof row, "space"> & { space?: WidgetSpace };
    if (resolvedSpace) out.space = resolvedSpace;
    return out;
  });
export type LayoutSection = z.infer<typeof layoutSectionSchema>;

// The page-level layout settings, shared by every board: the UI scale and the
// grid's spacing. What each board places lives on the board (boardLayoutSchema).
export const layoutSchema = z.object({
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

// What one board places (#298): its rows, in order. A board stored without
// rows is empty (every instance waits in the editor's tray).
export const boardLayoutSchema = z.object({
  // Which grid the stored spans are for. Always 24; kept so a future grid
  // change can tell which spans it has to convert.
  columns: z.literal(GRID_COLUMNS).catch(GRID_COLUMNS).default(GRID_COLUMNS),
  sections: lenientArray(layoutSectionSchema).default([]),
});
export type BoardLayout = z.infer<typeof boardLayoutSchema>;

// The page-level values as the settings PUT takes them. The settings PUT
// deep-merges, so each is optional.
export const layoutUpdateSchema = z.object({
  scale: z.number().int().min(MIN_UI_SCALE).max(MAX_UI_SCALE).optional(),
  gap: z.number().int().min(MIN_GRID_GAP).max(MAX_GRID_GAP).optional(),
  topGap: z.number().int().min(MIN_TOP_GAP).max(MAX_TOP_GAP).optional(),
});

// One layout row as admin input: the instance, and any placement values,
// each strictly bounded (the stored read is lenient instead). Hand-written
// rather than derived, since the stored row is a transform.
export const layoutRowInputSchema = z.object({
  widget: z.string().min(1).max(64),
  span: z.number().int().min(1).max(GRID_COLUMNS).optional(),
  hidden: z.boolean().optional(),
  cards: z.number().int().min(1).max(MAX_CARD_COLUMNS).optional(),
  hideLabel: z.boolean().optional(),
  height: z.number().int().min(MIN_WIDGET_HEIGHT).max(MAX_WIDGET_HEIGHT).optional(),
  space: widgetSpaceSchema.optional(),
});

// How many rows one board can hold: every instance once, with room to spare.
export const MAX_BOARD_ROWS = 128;

// The layout editor's save (PUT /api/boards/<id>/layout): the board's rows,
// and the page-level values the editor's toolbar tunes alongside them.
export const boardLayoutUpdateSchema = layoutUpdateSchema.extend({
  sections: z.array(layoutRowInputSchema).max(MAX_BOARD_ROWS),
});
