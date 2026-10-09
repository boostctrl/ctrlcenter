// The widget registry (#285): one entry per home-page widget type, in default
// layout order. Everything that used to be a parallel per-widget list —
// lib/layout.ts's ids, labels, defaults and capability lists, Dashboard's
// empty-state reasons and cell alignment — is derived from this table, so a
// widget's facts live in one place.
//
// Pure data, importable from server and client code alike. A widget's render
// component, server data loader and admin editor sit beside its entry in the
// other registries (see the new-widget skill).

// Every type can be placed any number of times (#297): each placement is an
// instance with its own content (lib/schema/instances.ts).
export type WidgetDef = {
  id: string;
  // Shown in the layout editor's frame and tray.
  label: string;
  // The default layout entry: column span on the 24-column grid, and whether
  // it ships hidden. `hidden` is the upgrade-path decision — a widget missing
  // from a saved layout is added with these defaults, so `hidden: false` would
  // make a new widget appear on every existing dashboard. New widgets ship
  // hidden.
  span: number;
  hidden: boolean;
  // A grid of cards: the layout editor offers a cards-per-row stepper.
  cards?: true;
  // Renders a section heading the layout editor can toggle off (hideLabel).
  titled?: true;
  // At an explicit height, scrolls its overflow (the others center instead).
  sized?: true;
  // Extra classes for the widget's grid cell (vertical alignment).
  align?: string;
  // The edit-mode placeholder: why the cell is empty and where to fix it.
  empty: string | ((ctx: { statusEnabled: boolean }) => string);
};

export const WIDGET_DEFS = [
  {
    id: "greeting",
    label: "Greeting",
    span: 16,
    hidden: false,
    align: "lg:self-center",
    // Always has content.
    empty: "Nothing to show yet.",
  },
  {
    id: "headerCard",
    label: "Header card",
    span: 8,
    hidden: false,
    align: "lg:self-center",
    empty:
      "Everything this card shows is off — enable the clock, weather, or status checks. The separate Clock, Weather and Status widgets are an alternative to this combined card.",
  },
  // The split clock/weather/status widgets exist hidden, ready to be shown
  // from the layout editor as an alternative to the combined card.
  {
    id: "clock",
    label: "Clock",
    span: 8,
    hidden: true,
    empty: "Date & clock is toggled off in the admin Layout settings.",
  },
  {
    id: "weather",
    label: "Weather",
    span: 8,
    hidden: true,
    empty: "Weather is disabled in the admin Weather settings.",
  },
  {
    id: "status",
    label: "Status",
    span: 8,
    hidden: true,
    empty: ({ statusEnabled }) =>
      statusEnabled
        ? "Waiting for the first status check…"
        : "Status checks are off, or there are no apps to monitor.",
  },
  {
    id: "search",
    label: "Search",
    span: 24,
    hidden: false,
    empty: "The search bar appears once there are apps or bookmarks to search.",
  },
  {
    id: "calendar",
    label: "Calendar",
    span: 24,
    hidden: false,
    titled: true,
    sized: true,
    empty: "No calendar URL yet — add it in admin Settings → Widgets → Calendars — or no upcoming events.",
  },
  // Ship dormant (hidden) so upgrades don't surprise existing dashboards; the
  // admin shows them from the layout editor or Settings → Layout.
  {
    id: "notes",
    label: "Notes",
    span: 8,
    hidden: true,
    titled: true,
    sized: true,
    empty: "The note is empty — write it in admin Settings → Widgets → Notes.",
  },
  {
    id: "feed",
    label: "RSS feed",
    span: 8,
    hidden: true,
    titled: true,
    sized: true,
    empty:
      "No feed URLs yet — add them in admin Settings → Widgets → RSS feeds.",
  },
  {
    id: "countdown",
    label: "Countdown",
    span: 8,
    hidden: true,
    titled: true,
    sized: true,
    empty: "No dates yet — add them in admin Settings → Widgets → Countdowns.",
  },
  {
    id: "worldClocks",
    label: "World clocks",
    span: 8,
    hidden: true,
    titled: true,
    sized: true,
    empty: "No time zones yet — add them in admin Settings → Widgets → World clocks.",
  },
  {
    id: "systemStats",
    label: "System stats",
    span: 8,
    hidden: true,
    titled: true,
    sized: true,
    empty: "System stats couldn't be read on this server — check the server logs.",
  },
  {
    id: "favorites",
    label: "Favorites",
    span: 24,
    hidden: false,
    cards: true,
    titled: true,
    sized: true,
    empty: "No pinned favorites yet.",
  },
  {
    id: "apps",
    label: "Applications",
    span: 24,
    hidden: false,
    cards: true,
    titled: true,
    sized: true,
    empty: "No applications yet — add them in the admin portal.",
  },
  {
    id: "bookmarks",
    label: "Bookmarks",
    span: 24,
    hidden: false,
    cards: true,
    titled: true,
    sized: true,
    empty: "No bookmarks yet — add them in the admin portal.",
  },
] as const satisfies readonly WidgetDef[];

export type WidgetId = (typeof WIDGET_DEFS)[number]["id"];

// The ids as a tuple type, in table order (z.enum needs the literal tuple).
// Generic so the mapped type keeps the tuple shape.
type IdsOf<T extends readonly { id: string }[]> = {
  readonly [K in keyof T]: T[K] extends { id: infer I } ? I : never;
};
export const WIDGET_IDS = WIDGET_DEFS.map((d) => d.id) as unknown as IdsOf<typeof WIDGET_DEFS>;

const BY_ID = new Map<string, WidgetDef>(WIDGET_DEFS.map((d) => [d.id, d]));

export function widgetDef(id: WidgetId): WidgetDef {
  return BY_ID.get(id)!;
}

// The ids whose entry has `flag` set, in table order.
export function widgetsWith(
  flag: "cards" | "titled" | "sized"
): WidgetId[] {
  return WIDGET_DEFS.filter((d: WidgetDef) => d[flag]).map((d) => d.id);
}

// The edit-mode placeholder text for an empty widget cell.
export function emptyReason(id: WidgetId, ctx: { statusEnabled: boolean }): string {
  const { empty } = widgetDef(id);
  return typeof empty === "function" ? empty(ctx) : empty;
}
