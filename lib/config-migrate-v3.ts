// The v2 → v3 config migration (3.0): widgets become instances (#297) and the
// layout becomes the first board (#298).
//
// v2 kept each widget's content in a fixed settings key (settings.notes,
// .countdown, .worldClocks, .systemStats, .calendar, the .feeds list) and
// placed widgets by type in settings.layout.sections, with legacy rules filling
// gaps: the pre-grid `components` visibility toggles, header widgets prepended
// when missing, one entry per feed instance. v3 has a top-level `widgets` list
// of instances, and a `boards` list whose layouts name them by id. The v2
// layout becomes the single `home` board; the UI scale and grid spacing stay
// in settings.layout, shared by every board.
//
// Each v2 widget becomes one instance whose id is its type name ("notes",
// "calendar"…), and each feed card keeps its own id, so links and anything
// keyed on them survive. The v2 layout is resolved once, here, with those
// legacy rules (frozen below as they shipped in 2.13), so the v3 layout lists
// every widget explicitly and the runtime needs none of them.
//
// Like the earlier steps it works on the raw YAML object, leaving everything
// it doesn't migrate untouched.

import { slugId } from "./slug";

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

// The layout's rows become the home board; scale and spacing stay behind. A
// layout that was never saved had the stock arrangement.
function layoutToBoards(settings: Record<string, unknown>): Record<string, unknown>[] {
  const layout = isRecord(settings.layout) ? settings.layout : {};
  const { sections, columns: _columns, ...page } = layout;
  void _columns;
  settings.layout = page;
  const rows = Array.isArray(sections)
    ? sections
    : V2_WIDGETS.map((w) => ({ widget: w.id, span: w.span, hidden: w.hidden }));
  return [{ id: "home", name: "Home", visibility: "public", layout: { columns: 24, sections: rows } }];
}

type Step = (raw: Record<string, unknown>) => { value: Record<string, unknown>; changed: boolean };

// The v2 → v3 step is three parts, each a no-op on a file that already has
// what it adds, so a file written by a 3.0 pre-release build (which may have
// instances but no boards, or boards but no groups) gets just the parts it's
// missing.
export function migrateV2toV3(raw: unknown): { value: unknown; changed: boolean } {
  if (!isRecord(raw)) return { value: raw, changed: false };
  let value = raw;
  let changed = false;
  for (const step of [instancesStep, boardsStep, groupsStep]) {
    const out = step(value);
    if (out.changed) {
      value = out.value;
      changed = true;
    }
  }
  return { value, changed };
}

// A pre-release file with instances may have kept saved rows in
// settings.layout. With none saved there's nothing to move: the stock home
// board is the default.
const boardsStep: Step = (raw) => {
  if (Array.isArray(raw.boards)) return { value: raw, changed: false };
  const settings: Record<string, unknown> = isRecord(raw.settings) ? { ...raw.settings } : {};
  if (!isRecord(settings.layout) || !Array.isArray(settings.layout.sections)) {
    return { value: raw, changed: false };
  }
  const boards = layoutToBoards(settings);
  return { value: { ...raw, settings, boards }, changed: true };
};

// Groups (#299): each bookmark category becomes a group, in the saved
// category order and then first-seen order, and each bookmark names its
// group by id. `groupPrivateApps` (the apps widget splitting private apps
// into their own block) becomes a second apps widget: the existing ones hide
// private apps, and a "Private Applications" one beside each shows only them.
const groupsStep: Step = (raw) => {
  const settings: Record<string, unknown> = isRecord(raw.settings) ? { ...raw.settings } : {};
  const bookmarks = Array.isArray(raw.bookmarks) ? raw.bookmarks : [];
  const legacy =
    "bookmarkCategoryOrder" in settings ||
    "groupPrivateApps" in settings ||
    bookmarks.some((b) => isRecord(b) && "category" in b);
  if (Array.isArray(raw.groups) || !legacy) return { value: raw, changed: false };

  const present: string[] = [];
  for (const b of bookmarks) {
    if (isRecord(b) && typeof b.category === "string" && !present.includes(b.category)) present.push(b.category);
  }
  const order = Array.isArray(settings.bookmarkCategoryOrder) ? settings.bookmarkCategoryOrder : [];
  const categories = [
    ...order.filter((c): c is string => typeof c === "string" && present.includes(c)),
    ...present,
  ].filter((c, i, all) => all.indexOf(c) === i);
  const idOf = new Map<string, string>();
  const groups = categories.map((name) => {
    const id = slugId(name, idOf.values(), "group");
    idOf.set(name, id);
    // A category that's only spaces still needs a name.
    return { id, name: name.trim() || id };
  });
  const nextBookmarks = bookmarks.map((b) => {
    if (!isRecord(b) || !("category" in b)) return b;
    const { category, ...rest } = b;
    return { ...rest, group: typeof category === "string" ? (idOf.get(category) ?? "") : "" };
  });

  let widgets = raw.widgets;
  let boards = raw.boards;
  if (settings.groupPrivateApps === true && Array.isArray(raw.widgets)) {
    const appsIds = raw.widgets
      .filter((w) => isRecord(w) && w.type === "apps" && typeof w.id === "string")
      .map((w) => (w as { id: string }).id);
    const taken = new Set(raw.widgets.filter(isRecord).map((w) => w.id));
    const privateId = (base: string) => {
      let id = `${base}-private`;
      for (let n = 2; taken.has(id); n++) id = `${base}-private-${n}`;
      taken.add(id);
      return id;
    };
    const twin = new Map(appsIds.map((id) => [id, privateId(id)]));
    widgets = raw.widgets.flatMap((w) => {
      if (!isRecord(w) || w.type !== "apps" || typeof w.id !== "string") return [w];
      const filter = isRecord(w.filter) ? w.filter : {};
      return [
        { ...w, filter: { ...filter, private: "hide" } },
        { id: twin.get(w.id), type: "apps", title: "Private Applications", filter: { private: "only" } },
      ];
    });
    if (Array.isArray(raw.boards)) {
      boards = raw.boards.map((board) => {
        if (!isRecord(board) || !isRecord(board.layout) || !Array.isArray(board.layout.sections)) return board;
        const sections = board.layout.sections.flatMap((row) => {
          if (!isRecord(row) || typeof row.widget !== "string" || !twin.has(row.widget)) return [row];
          const { span, hidden, cards } = row;
          return [row, { widget: twin.get(row.widget), span, hidden, ...(cards !== undefined ? { cards } : {}) }];
        });
        return { ...board, layout: { ...board.layout, sections } };
      });
    }
  }
  delete settings.bookmarkCategoryOrder;
  delete settings.groupPrivateApps;
  return {
    value: { ...raw, settings, groups, bookmarks: nextBookmarks, widgets, boards },
    changed: true,
  };
};

// Widgets become instances (#297) and the layout the home board (#298).
const instancesStep: Step = (raw) => {
  if (Array.isArray(raw.widgets) || Array.isArray(raw.boards) || raw.schemaVersion === 3) {
    return { value: raw, changed: false };
  }
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
  const boards = layoutToBoards(settings);

  if (typeof components.settingsButton === "boolean") settings.settingsButton = components.settingsButton;
  for (const key of ["notes", "countdown", "worldClocks", "systemStats", "calendar", "feeds", "components"]) {
    delete settings[key];
  }
  return { value: { ...raw, settings, boards, widgets: instances }, changed: true };
};
