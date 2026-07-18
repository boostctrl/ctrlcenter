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
  "worldClocks",
  "systemStats",
  "favorites",
  "apps",
  "bookmarks",
] as const;

export type LayoutWidgetId = (typeof LAYOUT_WIDGET_IDS)[number];

// Widget types that can appear more than once on the board, each bound to its
// own config instance. A multi-instance entry carries an `instanceId` (matching
// a config instance's id); its identity for keys, reordering and per-widget
// edits is that instanceId, not the type id. Single-instance widgets omit it
// and are identified by their type id as before. Feed is the first (and today
// only) instanceable type — the same machinery generalizes to notes/countdown.
export const INSTANCEABLE_WIDGET_IDS: readonly LayoutWidgetId[] = ["feed"];

// The default feed instance's id: the sole instance a fresh install ships and
// the target the single→list migration folds a pre-2.1 feed into. Shared by the
// layout default, the config schema, and lib/config-migrate.
export const FEED_DEFAULT_ID = "feed";

// A layout entry's stable identity: its instanceId for multi-instance widgets,
// else its type id. Keys, reorder matching, and the per-widget edit callbacks
// all go through this so two instances of the same type stay distinct.
export function widgetKey(w: { id: LayoutWidgetId; instanceId?: string }): string {
  return w.instanceId ?? w.id;
}

export const GRID_COLUMNS = 24;

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
  "worldClocks",
  "systemStats",
  "favorites",
  "apps",
  "bookmarks",
];

// The content/list widgets. When given an explicit `height` these scroll their
// overflow; the others (header widgets, search) center their content in the
// set height instead, so sizing the greeting/header card restores the classic
// centered header. Any widget can take a height — this set only decides
// scroll-vs-center behavior.
export const SIZED_WIDGET_IDS: readonly LayoutWidgetId[] = [
  "calendar",
  "notes",
  "feed",
  "countdown",
  "worldClocks",
  "systemStats",
  "favorites",
  "apps",
  "bookmarks",
];

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

export type LayoutWidget = {
  id: LayoutWidgetId;
  // Present only on multi-instance widgets (INSTANCEABLE_WIDGET_IDS): the id of
  // the config instance this entry renders. Its value is the entry's identity
  // (see widgetKey). Absent on single-instance widgets.
  instanceId?: string;
  span: number;
  hidden: boolean;
  // Cards per row (1–4) for the card-grid widgets; absent = auto from span.
  cards?: number;
  // Suppress the widget's section heading (the ALL-CAPS label above it) when
  // true; absent/false shows it. Only meaningful for TITLED_WIDGET_IDS.
  hideLabel?: boolean;
  // Explicit card height in px (the card is exactly this tall); absent = auto.
  height?: number;
  // Extra space (px, beyond the grid gap) on any side of the card; absent sides
  // and an absent object both mean none.
  space?: WidgetSpace;
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
  worldClocks: "World clocks",
  systemStats: "System stats",
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
  { id: "feed", instanceId: FEED_DEFAULT_ID, span: 8, hidden: true },
  { id: "countdown", span: 8, hidden: true },
  { id: "worldClocks", span: 8, hidden: true },
  { id: "systemStats", span: 8, hidden: true },
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

// One side's spacing value: a positive integer within the cap.
function isSpaceValue(v: unknown): v is number {
  return (
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_WIDGET_SPACE
  );
}

// A valid `space` object, keeping only the sides carrying an in-range value.
// Returns undefined when nothing valid remains, so an entry with no spacing
// stays clean (no empty object persisted).
function coerceSpace(v: unknown): WidgetSpace | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const raw = v as Record<string, unknown>;
  const out: WidgetSpace = {};
  for (const side of SPACE_SIDES) {
    if (isSpaceValue(raw[side])) out[side] = raw[side] as number;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
// the saved order, drop unknown ids and duplicates, coerce a bad span to the
// widget's default, keep a valid `cards` override, and resolve `hidden`
// (explicit boolean > folded legacy components toggle > visible-when-listed).
// Widgets the saved layout is missing are added — header widgets prepended,
// body widgets appended — with their defaults (legacy toggles still folded), so
// a config from any earlier version renders unchanged and a widget added in a
// future version still shows. Spans are expected on the 24-column grid — the
// one-time shape migration (lib/config-migrate.ts) rewrites pre-24 configs
// before anything parses them. Mirrors applyOrder in lib/config.ts.
export function resolveLayoutWidgets(
  saved:
    | readonly {
        id?: unknown;
        instanceId?: unknown;
        span?: unknown;
        hidden?: unknown;
        cards?: unknown;
        hideLabel?: unknown;
        height?: unknown;
        space?: unknown;
      }[]
    | undefined,
  components?: LegacyComponentToggles,
  // The feed config instance ids currently configured (settings.feeds). A saved
  // feed entry survives only while its instanceId is still one of these (its
  // config wasn't deleted); every configured instance not already placed is
  // appended hidden, so a newly-added feed card shows up ready to place.
  // Defaults to the single stock instance so callers that don't pass it (and
  // the layout default) behave exactly as a fresh install.
  feedInstanceIds: readonly string[] = [FEED_DEFAULT_ID]
): LayoutWidget[] {
  const knownFeedIds = new Set(feedInstanceIds);
  const listed: LayoutWidget[] = [];
  const seenSingles = new Set<LayoutWidgetId>();
  const placedFeedIds = new Set<string>();
  for (const item of saved ?? []) {
    const id = item?.id;
    if (!isWidgetId(id)) continue;
    const instanceable = INSTANCEABLE_WIDGET_IDS.includes(id);
    let instanceId: string | undefined;
    if (instanceable) {
      // A multi-instance entry is kept only when it names a still-configured
      // instance and hasn't already been placed (drops orphans + duplicates).
      instanceId = typeof item.instanceId === "string" ? item.instanceId : undefined;
      if (!instanceId || !knownFeedIds.has(instanceId) || placedFeedIds.has(instanceId))
        continue;
      placedFeedIds.add(instanceId);
    } else {
      if (seenSingles.has(id)) continue;
      seenSingles.add(id);
    }
    const span = isSpan(item.span) ? item.span : DEFAULT_BY_ID[id].span;
    const hidden =
      typeof item.hidden === "boolean"
        ? item.hidden
        : (legacyHidden(id, components) ?? false);
    const space = coerceSpace(item.space);
    listed.push({
      id,
      ...(instanceId ? { instanceId } : {}),
      span,
      hidden,
      ...(isCards(item.cards) ? { cards: item.cards } : {}),
      ...(typeof item.hideLabel === "boolean"
        ? { hideLabel: item.hideLabel }
        : {}),
      ...(isHeight(item.height) ? { height: item.height } : {}),
      ...(space ? { space } : {}),
    });
  }
  const missingHeader = HEADER_WIDGET_IDS.filter((id) => !seenSingles.has(id)).map(
    (id) => ({
      ...DEFAULT_BY_ID[id],
      hidden: legacyHidden(id, components) ?? DEFAULT_BY_ID[id].hidden,
    })
  );
  // Append every body widget the saved layout is missing, walking the canonical
  // order so the default arrangement reproduces exactly. At `feed`, emit one
  // hidden entry per configured instance not already placed.
  const appendedBody: LayoutWidget[] = [];
  for (const id of LAYOUT_WIDGET_IDS) {
    if (HEADER_WIDGET_IDS.includes(id)) continue;
    if (INSTANCEABLE_WIDGET_IDS.includes(id)) {
      for (const fid of feedInstanceIds) {
        if (!placedFeedIds.has(fid))
          appendedBody.push({
            id,
            instanceId: fid,
            span: DEFAULT_BY_ID[id].span,
            hidden: DEFAULT_BY_ID[id].hidden,
          });
      }
    } else if (!seenSingles.has(id)) {
      appendedBody.push({
        ...DEFAULT_BY_ID[id],
        hidden: legacyHidden(id, components) ?? DEFAULT_BY_ID[id].hidden,
      });
    }
  }
  return [...missingHeader, ...listed, ...appendedBody];
}
