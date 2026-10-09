import { WIDGET_DEFS, WIDGET_IDS, widgetsWith, type WidgetDef } from "./widgets/defs";

// The home-page widgets the admin can arrange on the dashboard's 24-column flow
// grid. Every widget has a position (its place in the ordered list), a column
// span (1–24) and a hidden flag; heights stay content-driven and rows pack
// automatically — there is no pinned x/y placement.

// The widget types, labels, defaults and capability lists below are derived
// from the widget registry (lib/widgets/defs.ts, #285) — add a widget there.
// What's placed on the grid is an instance of a type (#297): the layout names
// instances by id, and an instance's type decides how it renders.
export const WIDGET_TYPES = WIDGET_IDS;

export type WidgetType = (typeof WIDGET_TYPES)[number];

export const GRID_COLUMNS = 24;

// How many cards a widget's inner grid may show side by side (apps/bookmarks/
// favorites). `cards` on a layout entry is an explicit override; absent means
// "auto" — derived from the widget's span (see cardGridClass in Dashboard).
export const MAX_CARD_COLUMNS = 4;
export const CARD_WIDGET_TYPES: readonly WidgetType[] = widgetsWith("cards");

// Widgets that render a section heading (the shared SectionTitle) and so can
// have it toggled off per-widget from the layout editor (see `hideLabel`). The
// header widgets, search and the split clock/weather/status have no heading.
export const TITLED_WIDGET_TYPES: readonly WidgetType[] = widgetsWith("titled");

// The content/list widgets. When given an explicit `height` these scroll their
// overflow; the others (header widgets, search) center their content in the
// set height instead, so sizing the greeting/header card restores the classic
// centered header. Any widget can take a height — this set only decides
// scroll-vs-center behavior.
export const SIZED_WIDGET_TYPES: readonly WidgetType[] = widgetsWith("sized");

// Per-widget explicit height (px): the card is exactly this tall — taller than
// its content (breathing room / a header band) or shorter (content scrolls or
// is clipped). Absent = auto (content height). Available on every widget.
export const MIN_WIDGET_HEIGHT = 80;
export const MAX_WIDGET_HEIGHT = 800;
export const DEFAULT_WIDGET_HEIGHT = 320;
export const WIDGET_HEIGHT_STEP = 20;

// Per-widget extra space around a card (px), on top of the grid gap — for
// deliberately spacing one card from its neighbours on any side (e.g. above the
// header, or beside a card sharing its row). Each side is independent; absent =
// none on that side.
export const MAX_WIDGET_SPACE = 200;
export const WIDGET_SPACE_STEP = 8;
// The sides a card's `space` can carry, in the order the editor's directional
// control lays them out.
export const SPACE_SIDES = ["top", "right", "bottom", "left"] as const;
export type SpaceSide = (typeof SPACE_SIDES)[number];
export type WidgetSpace = Partial<Record<SpaceSide, number>>;

// The grid's vertical gap between cards (px). One value for the whole board,
// tunable from the edit toolbar. Column spacing stays fixed.
export const MIN_GRID_GAP = 0;
export const MAX_GRID_GAP = 96;
export const DEFAULT_GRID_GAP = 32;
export const GRID_GAP_STEP = 4;

// The page's gap above the first row of widgets (px), tunable from the edit
// toolbar. One stored value: it applies as-is on large screens and is capped
// at the small-screen stock value below them (small screens rarely want more
// air — the stock spacing already stepped down the same way). The default
// reproduces the stock 48px/64px pair exactly, so dashboards saved before the
// control existed don't shift.
export const MIN_TOP_GAP = 0;
export const MAX_TOP_GAP = 160;
export const DEFAULT_TOP_GAP = 64;
export const SMALL_TOP_GAP_CAP = 48;
export const TOP_GAP_STEP = 8;

// The top gap actually used below the lg breakpoint for a stored value.
export const smallScreenTopGap = (topGap: number): number =>
  Math.min(topGap, SMALL_TOP_GAP_CAP);

// Site-wide UI scale (percent), rendered as font-size on <html>: the whole UI
// is rem-based, so one percentage scales text, paddings and cards uniformly.
export const MIN_UI_SCALE = 70;
export const MAX_UI_SCALE = 150;
export const DEFAULT_UI_SCALE = 100;
export const UI_SCALE_STEP = 5;

// One placed widget, resolved: the instance (`id`) and its type, plus where
// and how it sits on the grid.
export type LayoutWidget = {
  id: string;
  type: WidgetType;
  span: number;
  hidden: boolean;
  cards?: number;
  hideLabel?: boolean;
  height?: number;
  space?: WidgetSpace;
};

// A layout row as stored and sent: the instance by id, and the placement.
export type LayoutSectionRow = Omit<LayoutWidget, "id" | "type"> & { widget: string };

export const WIDGET_LABELS = Object.fromEntries(
  WIDGET_DEFS.map((d) => [d.id, d.label])
) as Record<WidgetType, string>;

const DEFAULT_BY_TYPE = Object.fromEntries(
  WIDGET_DEFS.map((d: WidgetDef) => [d.id, d])
) as Record<WidgetType, WidgetDef>;

export function defaultSpanFor(type: WidgetType): number {
  return DEFAULT_BY_TYPE[type].span;
}

// The stock arrangement, over the stock instances (one per type, each named
// after its type): greeting beside the header card up top, the body widgets
// full-width below, the optional ones hidden. Registry order and defaults.
export const DEFAULT_SECTIONS: LayoutSectionRow[] = WIDGET_DEFS.map((d: WidgetDef) => ({
  widget: d.id,
  span: d.span,
  hidden: d.hidden,
}));

// The span that makes the widget at `index` fill to the end of its row — its
// current span plus any dead space trailing it. Walks the list in flow order
// (the same left-to-right wrap the CSS grid does) to find where the widget
// starts and whether it ends its row; a widget that already reaches the row's
// end, or that shares its row with a following widget, returns its own span
// (nothing to fill). Powers the editor's "Fill" button. Pure, so it's unit
// tested directly.
export function fillSpan(
  widgets: readonly { span: number }[],
  index: number,
  columns: number = GRID_COLUMNS
): number {
  const clamp = (s: number) => Math.min(columns, Math.max(1, s));
  let col = 0;
  for (let i = 0; i < widgets.length; i++) {
    const span = clamp(widgets[i].span);
    if (col + span > columns) col = 0; // doesn't fit — wraps to a new row
    if (i === index) {
      const next = i + 1 < widgets.length ? clamp(widgets[i + 1].span) : null;
      const endsRow = next === null || col + span + next > columns;
      return endsRow ? columns - col : span;
    }
    col += span;
    if (col >= columns) col = 0;
  }
  return clamp(widgets[index]?.span ?? columns);
}

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

function coerceSpace(v: unknown): WidgetSpace | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const raw = v as Record<string, unknown>;
  const out: WidgetSpace = {};
  for (const side of SPACE_SIDES) {
    if (isInt(raw[side], 1, MAX_WIDGET_SPACE)) out[side] = raw[side] as number;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// The arrangement to render (#297): the saved rows in order, each bound to its
// instance, then every instance no row places, appended hidden (the editor's
// tray, where a widget added in Settings waits to be shown). A row naming an
// instance that's gone, or one already placed, is skipped. Bad placement
// values fall back to the type's defaults. Pure.
export function resolveLayout(
  sections: readonly Partial<Record<keyof LayoutSectionRow, unknown>>[] | undefined,
  instances: readonly { id: string; type: WidgetType }[]
): LayoutWidget[] {
  const typeOf = new Map(instances.map((i) => [i.id, i.type]));
  const placed = new Set<string>();
  const out: LayoutWidget[] = [];
  for (const row of sections ?? []) {
    const id = row?.widget;
    if (typeof id !== "string") continue;
    const type = typeOf.get(id);
    if (!type || placed.has(id)) continue;
    placed.add(id);
    const space = coerceSpace(row.space);
    out.push({
      id,
      type,
      span: isInt(row.span, 1, GRID_COLUMNS) ? row.span : defaultSpanFor(type),
      hidden: typeof row.hidden === "boolean" ? row.hidden : false,
      ...(isInt(row.cards, 1, MAX_CARD_COLUMNS) ? { cards: row.cards } : {}),
      ...(typeof row.hideLabel === "boolean" ? { hideLabel: row.hideLabel } : {}),
      ...(isInt(row.height, MIN_WIDGET_HEIGHT, MAX_WIDGET_HEIGHT) ? { height: row.height } : {}),
      ...(space ? { space } : {}),
    });
  }
  for (const { id, type } of instances) {
    if (!placed.has(id)) out.push({ id, type, span: defaultSpanFor(type), hidden: true });
  }
  return out;
}

// The rows to store for a resolved arrangement.
export function toSections(widgets: readonly LayoutWidget[]): LayoutSectionRow[] {
  return widgets.map(({ id, type: _type, ...rest }) => {
    void _type;
    return { widget: id, ...rest };
  });
}
