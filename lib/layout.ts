// The home-page widgets the admin can arrange on the dashboard's 12-column flow
// grid. Every widget has a position (its place in the ordered list), a column
// span (1–12) and a hidden flag; heights stay content-driven and rows pack
// automatically — there is no pinned x/y placement.

export const LAYOUT_WIDGET_IDS = [
  "greeting",
  "headerCard",
  "clock",
  "weather",
  "status",
  "search",
  "calendar",
  "favorites",
  "apps",
  "bookmarks",
] as const;

export type LayoutWidgetId = (typeof LAYOUT_WIDGET_IDS)[number];

export const GRID_COLUMNS = 12;

// Legacy pre-1.3 widths (the old 6-column grid), still accepted when reading a
// stored config or an old export; they map onto 12-column spans below.
export const SECTION_WIDTHS = ["full", "twoThirds", "half", "third"] as const;
export type SectionWidth = (typeof SECTION_WIDTHS)[number];

export const WIDTH_TO_SPAN: Record<SectionWidth, number> = {
  full: 12,
  twoThirds: 8,
  half: 6,
  third: 4,
};

export type LayoutWidget = {
  id: LayoutWidgetId;
  span: number;
  hidden: boolean;
};

export const WIDGET_LABELS: Record<LayoutWidgetId, string> = {
  greeting: "Greeting",
  headerCard: "Header card",
  clock: "Clock",
  weather: "Weather",
  status: "Status",
  search: "Search",
  calendar: "Calendar",
  favorites: "Favorites",
  apps: "Applications",
  bookmarks: "Bookmarks",
};

// The default arrangement reproduces the pre-widget-grid page exactly: greeting
// beside the combined header card up top, the body sections full-width below.
// The split clock/weather/status widgets exist hidden, ready to be shown from
// the layout editor as an alternative to the combined card.
export const DEFAULT_WIDGETS: LayoutWidget[] = [
  { id: "greeting", span: 8, hidden: false },
  { id: "headerCard", span: 4, hidden: false },
  { id: "clock", span: 4, hidden: true },
  { id: "weather", span: 4, hidden: true },
  { id: "status", span: 4, hidden: true },
  { id: "search", span: 12, hidden: false },
  { id: "calendar", span: 12, hidden: false },
  { id: "favorites", span: 12, hidden: false },
  { id: "apps", span: 12, hidden: false },
  { id: "bookmarks", span: 12, hidden: false },
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
// legacy width when present, else the widget's default), and resolve `hidden`
// (explicit boolean > folded legacy components toggle > visible-when-listed).
// Widgets the saved layout is missing are added — header widgets prepended,
// body widgets appended — with their defaults (legacy toggles still folded), so
// a config from any earlier version renders unchanged and a widget added in a
// future version still shows. Mirrors applyOrder in lib/config.ts.
export function resolveLayoutWidgets(
  saved:
    | readonly {
        id?: unknown;
        span?: unknown;
        width?: unknown;
        hidden?: unknown;
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
    listed.push({ id, span, hidden });
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
