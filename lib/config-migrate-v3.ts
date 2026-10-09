// The v2 → v3 config migration (#297, 3.0): widgets become instances.
//
// v2 kept each widget's content in a fixed settings key (settings.notes,
// .countdown, .worldClocks, .systemStats, .calendar, the .feeds list) and
// placed widgets by type in settings.layout.sections, with legacy rules filling
// gaps: the pre-grid `components` visibility toggles, header widgets prepended
// when missing, one entry per feed instance. v3 has a top-level `widgets` list
// of instances, and layout sections that name one by id.
//
// Each v2 widget becomes one instance whose id is its type name ("notes",
// "calendar"…), and each feed card keeps its own id, so links and anything
// keyed on them survive. The v2 layout is resolved once, here, with those
// legacy rules (frozen below as they shipped in 2.13), so the v3 layout lists
// every widget explicitly and the runtime needs none of them.
//
// Like the earlier steps it works on the raw YAML object, leaving everything
// it doesn't migrate untouched.

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// --- Frozen: the v2 widget table and layout resolver, as of 2.13 ------------

const V2_WIDGETS = [
  { id: "greeting", span: 16, hidden: false, header: true },
  { id: "headerCard", span: 8, hidden: false, header: true },
  { id: "clock", span: 8, hidden: true, header: true },
  { id: "weather", span: 8, hidden: true, header: true },
  { id: "status", span: 8, hidden: true, header: true },
  { id: "search", span: 24, hidden: false },
  { id: "calendar", span: 24, hidden: false },
  { id: "notes", span: 8, hidden: true },
  { id: "feed", span: 8, hidden: true },
  { id: "countdown", span: 8, hidden: true },
  { id: "worldClocks", span: 8, hidden: true },
  { id: "systemStats", span: 8, hidden: true },
  { id: "favorites", span: 24, hidden: false },
  { id: "apps", span: 24, hidden: false },
  { id: "bookmarks", span: 24, hidden: false },
] as const;
type V2Id = (typeof V2_WIDGETS)[number]["id"];
const V2_BY_ID = new Map<string, (typeof V2_WIDGETS)[number]>(V2_WIDGETS.map((w) => [w.id, w]));

// The v2 single feed card's id, and what a pre-list config's feed became.
const FEED_DEFAULT_ID = "feed";

// The pre-grid visibility toggles that still decided `hidden` for a v2 layout
// row saved without one.
const LEGACY_TOGGLES = ["greeting", "search", "apps", "bookmarks", "favorites"];

type Row = {
  type: V2Id;
  // The instance it renders: the feed card's id, else the type.
  widget: string;
  span: number;
  hidden: boolean;
  extra: Record<string, unknown>;
};

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

function legacyHidden(id: string, components: Record<string, unknown>): boolean | undefined {
  if (!LEGACY_TOGGLES.includes(id)) return undefined;
  const flag = components[id];
  return typeof flag === "boolean" ? !flag : undefined;
}

// The v2 layout, resolved: saved rows in order (first of each type, each feed
// card once), missing header widgets prepended, every other missing widget
// appended in table order. Row tweaks (cards, hideLabel, height, space) pass
// through as stored; the v3 schema validates them.
function resolveV2Layout(
  sections: unknown,
  components: Record<string, unknown>,
  feedIds: string[]
): Row[] {
  const known = new Set(feedIds);
  const placedFeeds = new Set<string>();
  const seen = new Set<string>();
  const listed: Row[] = [];
  for (const item of Array.isArray(sections) ? sections : []) {
    if (!isRecord(item)) continue;
    const def = typeof item.id === "string" ? V2_BY_ID.get(item.id) : undefined;
    if (!def) continue;
    let widget: string = def.id;
    if (def.id === "feed") {
      const fid = item.instanceId;
      if (typeof fid !== "string" || !known.has(fid) || placedFeeds.has(fid)) continue;
      placedFeeds.add(fid);
      widget = fid;
    } else {
      if (seen.has(def.id)) continue;
      seen.add(def.id);
    }
    const { id: _id, instanceId: _iid, span, hidden, ...extra } = item;
    void _id;
    void _iid;
    listed.push({
      type: def.id,
      widget,
      span: isInt(span, 1, 24) ? span : def.span,
      hidden: typeof hidden === "boolean" ? hidden : (legacyHidden(def.id, components) ?? false),
      extra,
    });
  }
  const row = (def: (typeof V2_WIDGETS)[number], widget: string = def.id): Row => ({
    type: def.id,
    widget,
    span: def.span,
    hidden: legacyHidden(def.id, components) ?? def.hidden,
    extra: {},
  });
  const header = V2_WIDGETS.filter((d) => "header" in d && !seen.has(d.id)).map((d) => row(d));
  const body: Row[] = [];
  for (const def of V2_WIDGETS) {
    if ("header" in def) continue;
    if (def.id === "feed") {
      for (const fid of feedIds) if (!placedFeeds.has(fid)) body.push({ ...row(def, fid), hidden: def.hidden });
    } else if (!seen.has(def.id)) {
      body.push(row(def));
    }
  }
  return [...header, ...listed, ...body];
}

// --- The step ----------------------------------------------------------------

// v3 instance ids are URL-safe; a hand-edited v2 feed id might not be.
function safeId(raw: string, taken: Set<string>): string {
  let id = raw.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "feed";
  const stem = id;
  for (let n = 2; taken.has(id); n++) id = `${stem.slice(0, 60)}-${n}`;
  taken.add(id);
  return id;
}

export function migrateV2toV3(raw: unknown): { value: unknown; changed: boolean } {
  if (!isRecord(raw) || Array.isArray(raw.widgets)) return { value: raw, changed: false };
  const settings: Record<string, unknown> = isRecord(raw.settings) ? { ...raw.settings } : {};
  const components = isRecord(settings.components) ? settings.components : {};

  // Feed cards keep their ids (made URL-safe if needed). A config that never
  // had the key had v2's default: one stock card.
  const taken = new Set<string>(V2_WIDGETS.filter((w) => w.id !== "feed").map((w) => w.id));
  const rename = new Map<string, string>();
  const feeds = (Array.isArray(settings.feeds) ? settings.feeds : [{ id: FEED_DEFAULT_ID }])
    .filter(isRecord)
    .flatMap((f) => {
      const was = typeof f.id === "string" && f.id !== "" ? f.id : FEED_DEFAULT_ID;
      if (rename.has(was)) return []; // a duplicate id rendered once in v2
      const id = safeId(was, taken);
      rename.set(was, id);
      return [{ ...f, id, type: "feed" } as Record<string, unknown>];
    });

  const content = (key: string) => (isRecord(settings[key]) ? settings[key] : {});
  const instances: Record<string, unknown>[] = [];
  for (const def of V2_WIDGETS) {
    if (def.id === "feed") {
      instances.push(...feeds);
    } else if (def.id === "headerCard") {
      const showClock = components.clock;
      instances.push({ id: def.id, type: def.id, ...(typeof showClock === "boolean" ? { showClock } : {}) });
    } else if (["calendar", "notes", "countdown", "worldClocks", "systemStats"].includes(def.id)) {
      instances.push({ ...content(def.id), id: def.id, type: def.id });
    } else {
      instances.push({ id: def.id, type: def.id });
    }
  }

  const layout = isRecord(settings.layout) ? { ...settings.layout } : {};
  const rows = resolveV2Layout(layout.sections, components, [...rename.keys()]);
  // Whether v2 had this row's content switched off: its clock widget showed
  // nothing with the clock off, and a feed card or the calendar with its own
  // `enabled` off showed nothing either. v3 has no such switches; the row is
  // hidden instead, so nothing suddenly appears.
  const feedOff = new Set(
    feeds.filter((f) => f.enabled !== true).map((f) => f.id as string)
  );
  const switchedOff = (r: Row, widget: string) =>
    (r.type === "clock" && components.clock === false) ||
    (r.type === "feed" && feedOff.has(widget)) ||
    (r.type === "calendar" && content("calendar").enabled !== true);
  layout.sections = rows.map((r) => {
    const widget = r.type === "feed" ? rename.get(r.widget)! : r.widget;
    return { widget, span: r.span, hidden: r.hidden || switchedOff(r, widget), ...r.extra };
  });
  settings.layout = layout;

  if (typeof components.settingsButton === "boolean") settings.settingsButton = components.settingsButton;
  for (const key of ["notes", "countdown", "worldClocks", "systemStats", "calendar", "feeds", "components"]) {
    delete settings[key];
  }
  return { value: { ...raw, settings, widgets: instances }, changed: true };
}
