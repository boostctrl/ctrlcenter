// The home-page widgets the admin can arrange on the dashboard's 24-column flow
// grid. Every widget has a position (its place in the ordered list), a column
// span (1–24) and a hidden flag; heights stay content-driven and rows pack
// automatically — there is no pinned x/y placement.

export const LAYOUT_WIDGET_IDS = [
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
  "favorites",
  "apps",
  "bookmarks",
] as const;

export type LayoutWidgetId = (typeof LAYOUT_WIDGET_IDS)[number];

export const GRID_COLUMNS = 24;

// The 1.3 grid was 12 columns. Stored spans from that era double onto today's
// 24-column grid; a `columns` marker on the persisted layout says which grid a
// config's spans were saved against (absent = 12).
export const LEGACY_GRID_COLUMNS = 12;

// Legacy pre-1.3 widths (the old 6-column grid), still accepted when reading a
// stored config or an old export; they map onto 24-column spans below.
export const SECTION_WIDTHS = ["full", "twoThirds", "half", "third"] as const;
export type SectionWidth = (typeof SECTION_WIDTHS)[number];

export const WIDTH_TO_SPAN: Record<SectionWidth, number> = {
  full: 24,
  twoThirds: 16,
  half: 12,
  third: 8,
};

// How many cards a widget's inner grid may show side by side (apps/bookmarks/
// favorites). `cards` on a layout entry is an explicit override; absent means
// "auto" — derived from the widget's span (see cardGridClass in Dashboard).
export const MAX_CARD_COLUMNS = 4;
export const CARD_WIDGET_IDS: readonly LayoutWidgetId[] = [
  "favorites",
  "apps",
  "bookmarks",
];

// Widgets that render a section heading (the shared SectionTitle) and so can
// have it toggled off per-widget from the layout editor (see `hideLabel`). The
// header widgets, search and the split clock/weather/status have no heading.
export const TITLED_WIDGET_IDS: readonly LayoutWidgetId[] = [
  "calendar",
  "notes",
  "feed",
  "countdown",
  "favorites",
  "apps",
  "bookmarks",
];

// Widgets whose content can be capped to a max height (a scrollable body) from
// the layout editor — the content/list widgets, where trimming a tall list to a
// compact card makes sense. The header widgets, search and the split
// clock/weather/status are fixed-size and aren't capped.
export const SIZED_WIDGET_IDS: readonly LayoutWidgetId[] = [
  "calendar",
  "notes",
  "feed",
  "countdown",
  "favorites",
  "apps",
  "bookmarks",
];

// Per-widget max content height (px). A widget with `height` set never grows
// past it (its body scrolls); a shorter widget is unaffected. Absent = auto
// (content height). Bounds/step drive the editor stepper and clamp stored
// values. The whole UI is rem-based but heights are kept in px for a concrete,
// predictable cap.
export const MIN_WIDGET_HEIGHT = 120;
export const MAX_WIDGET_HEIGHT = 800;
export const DEFAULT_WIDGET_HEIGHT = 320;
export const WIDGET_HEIGHT_STEP = 40;

// Site-wide UI scale (percent), rendered as font-size on <html>: the whole UI
// is rem-based, so one percentage scales text, paddings and cards uniformly.
export const MIN_UI_SCALE = 70;
export const MAX_UI_SCALE = 150;
export const DEFAULT_UI_SCALE = 100;
export const UI_SCALE_STEP = 5;

export type LayoutWidget = {
  id: LayoutWidgetId;
  span: number;
  hidden: boolean;
  // Cards per row (1–4) for the card-grid widgets; absent = auto from span.
  cards?: number;
  // Suppress the widget's section heading (the ALL-CAPS label above it) when
  // true; absent/false shows it. Only meaningful for TITLED_WIDGET_IDS.
  hideLabel?: boolean;
  // Max content height in px (body scrolls past it); absent = auto. Only
  // meaningful for SIZED_WIDGET_IDS.
  height?: number;
};

export const WIDGET_LABELS: Record<LayoutWidgetId, string> = {
  greeting: "Greeting",
  headerCard: "Header card",
  clock: "Clock",
  weather: "Weather",
  status: "Status",
  search: "Search",
  calendar: "Calendar",
  notes: "Notes",
  feed: "RSS feed",
  countdown: "Countdown",
  favorites: "Favorites",
  apps: "Applications",
  bookmarks: "Bookmarks",
};

// The default arrangement reproduces the pre-widget-grid page exactly: greeting
// beside the combined header card up top, the body sections full-width below.
// The split clock/weather/status widgets exist hidden, ready to be shown from
// the layout editor as an alternative to the combined card.
export const DEFAULT_WIDGETS: LayoutWidget[] = [
  { id: "greeting", span: 16, hidden: false },
  { id: "headerCard", span: 8, hidden: false },
  { id: "clock", span: 8, hidden: true },
  { id: "weather", span: 8, hidden: true },
  { id: "status", span: 8, hidden: true },
  { id: "search", span: 24, hidden: false },
  { id: "calendar", span: 24, hidden: false },
  // Ship dormant (hidden) so upgrades don't surprise existing dashboards;
  // the admin shows them from the layout editor or Settings → Layout.
  { id: "notes", span: 8, hidden: true },
  { id: "feed", span: 8, hidden: true },
  { id: "countdown", span: 8, hidden: true },
  { id: "favorites", span: 24, hidden: false },
  { id: "apps", span: 24, hidden: false },
  { id: "bookmarks", span: 24, hidden: false },
];

// The widgets that used to live in the fixed header. When missing from a saved
// layout they're PREPENDED in this order (body widgets are appended), so a
// config saved before they were placeable renders with them on top — exactly
// where the fixed header used to be.
export const HEADER_WIDGET_IDS: readonly LayoutWidgetId[] = [
  "greeting",
  "headerCard",
  "clock",
  "weather",
  "status",
];

const DEFAULT_BY_ID = Object.fromEntries(
  DEFAULT_WIDGETS.map((w) => [w.id, w])
) as Record<LayoutWidgetId, LayoutWidget>;

export function defaultSpanFor(id: LayoutWidgetId): number {
  return DEFAULT_BY_ID[id].span;
}

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

// Widget visibility used to live in settings.components. Those flags fold into
// `hidden` only for entries (or whole widgets) the new UI hasn't written yet —
// once a layout entry carries an explicit `hidden`, the legacy flag is ignored.
// Structural type on purpose: lib/schema imports from this file, so importing
// its ComponentsConfig here would be a cycle.
export type LegacyComponentToggles = {
  greeting?: boolean;
  search?: boolean;
  apps?: boolean;
  bookmarks?: boolean;
  favorites?: boolean;
};

const LEGACY_TOGGLE_IDS = [
  "greeting",
  "search",
  "apps",
  "bookmarks",
  "favorites",
] as const;

function isWidgetId(v: unknown): v is LayoutWidgetId {
  return (
    typeof v === "string" && (LAYOUT_WIDGET_IDS as readonly string[]).includes(v)
  );
}

function isWidth(v: unknown): v is SectionWidth {
  return (
    typeof v === "string" && (SECTION_WIDTHS as readonly string[]).includes(v)
  );
}

function isSpan(v: unknown): v is number {
  return (
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= GRID_COLUMNS
  );
}

function isCards(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= 1 &&
    v <= MAX_CARD_COLUMNS
  );
}

function isHeight(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= MIN_WIDGET_HEIGHT &&
    v <= MAX_WIDGET_HEIGHT
  );
}

function legacyHidden(
  id: LayoutWidgetId,
  components: LegacyComponentToggles | undefined
): boolean | undefined {
  if (!components) return undefined;
  if (!(LEGACY_TOGGLE_IDS as readonly string[]).includes(id)) return undefined;
  const flag = components[id as (typeof LEGACY_TOGGLE_IDS)[number]];
  return flag === undefined ? undefined : !flag;
}

// Normalize a stored/partial layout into a concrete, complete widget list: keep
// the saved order, drop unknown ids and duplicates, coerce a bad span (via a
// legacy width when present, else the widget's default), keep a valid `cards`
// override, and resolve `hidden` (explicit boolean > folded legacy components
// toggle > visible-when-listed). Widgets the saved layout is missing are added
// — header widgets prepended, body widgets appended — with their defaults
// (legacy toggles still folded), so a config from any earlier version renders
// unchanged and a widget added in a future version still shows. Spans are
// expected on the 24-column grid — the schema layer doubles pre-24 configs
// before this runs. Mirrors applyOrder in lib/config.ts.
export function resolveLayoutWidgets(
  saved:
    | readonly {
        id?: unknown;
        span?: unknown;
        width?: unknown;
        hidden?: unknown;
        cards?: unknown;
        hideLabel?: unknown;
        height?: unknown;
      }[]
    | undefined,
  components?: LegacyComponentToggles
): LayoutWidget[] {
  const listed: LayoutWidget[] = [];
  const seen = new Set<LayoutWidgetId>();
  for (const item of saved ?? []) {
    const id = item?.id;
    if (!isWidgetId(id) || seen.has(id)) continue;
    seen.add(id);
    const span = isSpan(item.span)
      ? item.span
      : isWidth(item.width)
        ? WIDTH_TO_SPAN[item.width]
        : DEFAULT_BY_ID[id].span;
    const hidden =
      typeof item.hidden === "boolean"
        ? item.hidden
        : (legacyHidden(id, components) ?? false);
    listed.push({
      id,
      span,
      hidden,
      ...(isCards(item.cards) ? { cards: item.cards } : {}),
      ...(typeof item.hideLabel === "boolean"
        ? { hideLabel: item.hideLabel }
        : {}),
      ...(isHeight(item.height) ? { height: item.height } : {}),
    });
  }
  const missing = (ids: readonly LayoutWidgetId[]) =>
    ids
      .filter((id) => !seen.has(id))
      .map((id) => ({
        ...DEFAULT_BY_ID[id],
        hidden: legacyHidden(id, components) ?? DEFAULT_BY_ID[id].hidden,
      }));
  return [
    ...missing(HEADER_WIDGET_IDS),
    ...listed,
    ...missing(LAYOUT_WIDGET_IDS.filter((id) => !HEADER_WIDGET_IDS.includes(id))),
  ];
}
