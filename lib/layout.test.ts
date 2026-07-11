import { describe, it, expect } from "vitest";
import {
  resolveLayoutWidgets,
  fillSpan,
  LAYOUT_WIDGET_IDS,
  HEADER_WIDGET_IDS,
  DEFAULT_WIDGETS,
  type LayoutWidgetId,
} from "./layout";
import { settingsSchema, layoutSchema, layoutUpdateSchema } from "./schema";

describe("resolveLayoutWidgets", () => {
  it("defaults to the full catalog, in canonical order, for empty/undefined", () => {
    expect(resolveLayoutWidgets(undefined)).toEqual(DEFAULT_WIDGETS);
    expect(resolveLayoutWidgets([])).toEqual(DEFAULT_WIDGETS);
  });

  it("keeps saved order/span/hidden and adds what's missing", () => {
    const saved = [
      { id: "bookmarks", span: 6, hidden: false },
      { id: "apps", span: 6, hidden: true },
    ];
    const out = resolveLayoutWidgets(saved);
    // Header widgets are prepended, then the saved order, then missing body
    // widgets appended.
    expect(out.slice(0, HEADER_WIDGET_IDS.length).map((w) => w.id)).toEqual([
      ...HEADER_WIDGET_IDS,
    ]);
    const afterHeader = out.slice(HEADER_WIDGET_IDS.length);
    expect(afterHeader.slice(0, 2)).toEqual(saved);
    expect(afterHeader.slice(2).map((w) => w.id)).toEqual([
      "search",
      "calendar",
      "notes",
      "feed",
      "countdown",
      "worldClocks",
      "favorites",
    ]);
    // Every widget appears exactly once.
    expect(out.map((w) => w.id).sort()).toEqual([...LAYOUT_WIDGET_IDS].sort());
  });

  it("maps legacy widths to spans (full/twoThirds/half/third → 24/16/12/8)", () => {
    const out = resolveLayoutWidgets([
      { id: "search", width: "full" },
      { id: "apps", width: "twoThirds" },
      { id: "bookmarks", width: "half" },
      { id: "calendar", width: "third" },
    ]);
    expect(out.find((w) => w.id === "search")?.span).toBe(24);
    expect(out.find((w) => w.id === "apps")?.span).toBe(16);
    expect(out.find((w) => w.id === "bookmarks")?.span).toBe(12);
    expect(out.find((w) => w.id === "calendar")?.span).toBe(8);
  });

  it("renders a legacy 5-section layout exactly like the old page", () => {
    // A pre-widget config: only body sections saved, header fixed on top.
    const out = resolveLayoutWidgets([
      { id: "search", width: "full" },
      { id: "calendar", width: "half" },
      { id: "favorites", width: "full" },
      { id: "apps", width: "full" },
      { id: "bookmarks", width: "half" },
    ]);
    expect(out.map((w) => w.id)).toEqual([
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
      "notes",
      "feed",
      "countdown",
      "worldClocks",
    ]);
    // Combined card visible, split widgets hidden — today's look.
    expect(out.find((w) => w.id === "headerCard")?.hidden).toBe(false);
    expect(out.find((w) => w.id === "clock")?.hidden).toBe(true);
    expect(out.find((w) => w.id === "weather")?.hidden).toBe(true);
    expect(out.find((w) => w.id === "status")?.hidden).toBe(true);
  });

  it("drops unknown ids and duplicates, and coerces a bad span to the default", () => {
    const out = resolveLayoutWidgets([
      { id: "apps", span: 6 },
      { id: "apps", span: 12 }, // duplicate id — ignored (first wins)
      { id: "nope" as LayoutWidgetId, span: 6 }, // unknown — dropped
      { id: "search", span: 25 }, // out of range — default span
      { id: "bookmarks", span: 2.5 }, // not an integer — default span
    ]);
    expect(out.find((w) => w.id === "apps")?.span).toBe(6);
    expect(out.find((w) => w.id === "search")?.span).toBe(24);
    expect(out.find((w) => w.id === "bookmarks")?.span).toBe(24);
    expect(out.some((w) => (w.id as string) === "nope")).toBe(false);
    expect(out).toHaveLength(LAYOUT_WIDGET_IDS.length);
  });

  it("keeps a valid cards override and drops an invalid one", () => {
    const out = resolveLayoutWidgets([
      { id: "apps", span: 24, cards: 4 },
      { id: "bookmarks", span: 24, cards: 0 }, // out of range — dropped
      { id: "favorites", span: 24, cards: 2.5 }, // not an integer — dropped
    ]);
    expect(out.find((w) => w.id === "apps")?.cards).toBe(4);
    expect("cards" in out.find((w) => w.id === "bookmarks")!).toBe(false);
    expect("cards" in out.find((w) => w.id === "favorites")!).toBe(false);
  });

  it("keeps a boolean hideLabel and ignores a non-boolean one", () => {
    const out = resolveLayoutWidgets([
      { id: "apps", span: 24, hideLabel: true },
      { id: "bookmarks", span: 24, hideLabel: "yes" },
      { id: "favorites", span: 24 }, // absent — stays off
    ]);
    expect(out.find((w) => w.id === "apps")?.hideLabel).toBe(true);
    expect("hideLabel" in out.find((w) => w.id === "bookmarks")!).toBe(false);
    expect("hideLabel" in out.find((w) => w.id === "favorites")!).toBe(false);
  });

  it("keeps an in-range integer height and drops an invalid one", () => {
    const out = resolveLayoutWidgets([
      { id: "apps", span: 24, height: 320 },
      { id: "bookmarks", span: 24, height: 50 }, // below min — dropped
      { id: "feed", span: 24, height: 300.5 }, // not an integer — dropped
      { id: "notes", span: 24, height: 99999 }, // above max — dropped
      { id: "favorites", span: 24 }, // absent — stays auto
    ]);
    expect(out.find((w) => w.id === "apps")?.height).toBe(320);
    expect("height" in out.find((w) => w.id === "bookmarks")!).toBe(false);
    expect("height" in out.find((w) => w.id === "feed")!).toBe(false);
    expect("height" in out.find((w) => w.id === "notes")!).toBe(false);
    expect("height" in out.find((w) => w.id === "favorites")!).toBe(false);
  });

  it("keeps valid per-side space values and drops invalid sides", () => {
    const out = resolveLayoutWidgets([
      { id: "apps", span: 24, space: { top: 24, bottom: 16 } },
      // A bad side is dropped; a valid side on the same entry survives.
      { id: "bookmarks", span: 24, space: { left: 8, right: 0, top: 99999 } },
      { id: "feed", span: 24, space: { top: 12.5 } }, // non-integer — dropped
      { id: "notes", span: 24 }, // absent — none
    ]);
    expect(out.find((w) => w.id === "apps")?.space).toEqual({ top: 24, bottom: 16 });
    expect(out.find((w) => w.id === "bookmarks")?.space).toEqual({ left: 8 });
    expect("space" in out.find((w) => w.id === "feed")!).toBe(false);
    expect("space" in out.find((w) => w.id === "notes")!).toBe(false);
  });

  it("migrates a legacy spaceBelow into space.bottom", () => {
    const out = resolveLayoutWidgets([
      { id: "apps", span: 24, spaceBelow: 40 },
      { id: "bookmarks", span: 24, spaceBelow: 0 }, // not >= 1 — dropped
      // An explicit `space` wins over a legacy spaceBelow on the same entry.
      { id: "feed", span: 24, space: { top: 8 }, spaceBelow: 40 },
    ]);
    expect(out.find((w) => w.id === "apps")?.space).toEqual({ bottom: 40 });
    expect("space" in out.find((w) => w.id === "bookmarks")!).toBe(false);
    expect(out.find((w) => w.id === "feed")?.space).toEqual({ top: 8 });
  });

  it("folds legacy components toggles into hidden for entries without one", () => {
    const components = { greeting: false, apps: false, search: true };
    const out = resolveLayoutWidgets(
      [
        { id: "search", width: "full" },
        { id: "apps", width: "full" }, // no hidden — folds components.apps
      ],
      components
    );
    // Saved entry without hidden folds the toggle…
    expect(out.find((w) => w.id === "apps")?.hidden).toBe(true);
    expect(out.find((w) => w.id === "search")?.hidden).toBe(false);
    // …and so does a missing widget (greeting was never in the saved list).
    expect(out.find((w) => w.id === "greeting")?.hidden).toBe(true);
    // Toggles without an opinion leave the default.
    expect(out.find((w) => w.id === "bookmarks")?.hidden).toBe(false);
  });

  it("prefers an explicit hidden over the legacy toggle", () => {
    const out = resolveLayoutWidgets(
      [{ id: "apps", span: 12, hidden: false }],
      { apps: false }
    );
    expect(out.find((w) => w.id === "apps")?.hidden).toBe(false);
  });

  it("appends widgets added in later versions, dormant, to an older layout", () => {
    // The upgrade path: a full layout saved before notes/feed existed must
    // render unchanged, with the new widgets appended hidden at their default
    // spans.
    const added: LayoutWidgetId[] = ["notes", "feed", "countdown", "worldClocks"];
    const older = LAYOUT_WIDGET_IDS.filter((id) => !added.includes(id)).map(
      (id) => ({ id, span: 24, hidden: false })
    );
    const out = resolveLayoutWidgets(older);
    expect(out.map((w) => w.id)).toEqual([...older.map((w) => w.id), ...added]);
    for (const id of added) {
      expect(out.find((w) => w.id === id)).toEqual({ id, span: 8, hidden: true });
    }
  });
});

describe("fillSpan", () => {
  const w = (span: number) => ({ span });

  it("returns the current span when the widget already ends its row", () => {
    expect(fillSpan([w(24)], 0)).toBe(24);
    expect(fillSpan([w(12), w(12)], 1)).toBe(12); // second half of a full row
  });

  it("returns the current span when the next widget shares its row", () => {
    // a and b sit together on row 0 (8+8); only the trailing 24 wraps below.
    expect(fillSpan([w(8), w(8), w(24)], 0)).toBe(8);
  });

  it("expands to the end of the row when dead space trails the widget", () => {
    // b ends row 0 with 8 columns free before the 24-wide widget wraps below.
    expect(fillSpan([w(8), w(8), w(24)], 1)).toBe(16);
    // a lone narrow widget fills the whole row.
    expect(fillSpan([w(8)], 0)).toBe(24);
  });

  it("accounts for wrapping when it finds the row", () => {
    // 16 + 16 can't share a row: the second wraps to row 1 and fills it, and
    // the first has 8 trailing columns on row 0.
    expect(fillSpan([w(16), w(16)], 0)).toBe(24);
    expect(fillSpan([w(16), w(16)], 1)).toBe(24);
  });

  it("respects a custom column count", () => {
    expect(fillSpan([w(3)], 0, 12)).toBe(12);
  });
});

describe("layout schema", () => {
  it("settingsSchema defaults to the full widget catalog on the 24-column grid", () => {
    const layout = settingsSchema.parse({}).layout;
    expect(layout.sections).toEqual(DEFAULT_WIDGETS);
    expect(layout.columns).toBe(24);
    expect(layout.scale).toBe(100);
  });

  it("transforms the legacy width shape to a span (and re-parses idempotently)", () => {
    const once = layoutSchema.parse({
      sections: [{ id: "apps", width: "half" }],
    });
    expect(once.sections).toEqual([{ id: "apps", span: 12 }]);
    // Re-parsing the output (as writeConfig does) is a no-op.
    expect(layoutSchema.parse(once)).toEqual(once);
  });

  it("doubles spans saved on the 12-column grid exactly once", () => {
    // A 1.3-era config: spans on the 12-column grid, no `columns` marker.
    const once = layoutSchema.parse({
      sections: [
        { id: "apps", span: 6 },
        { id: "search", span: 12, hidden: true },
      ],
    });
    expect(once.sections).toEqual([
      { id: "apps", span: 12 },
      { id: "search", span: 24, hidden: true },
    ]);
    expect(once.columns).toBe(24);
    // Re-parsing (as writeConfig does on every save) must not double again.
    expect(layoutSchema.parse(once)).toEqual(once);
  });

  it("leaves 24-based spans alone when the columns marker is present", () => {
    const parsed = layoutSchema.parse({
      sections: [{ id: "apps", span: 7 }],
      columns: 24,
    });
    expect(parsed.sections).toEqual([{ id: "apps", span: 7 }]);
  });

  it("doesn't double legacy width rows (they map straight to 24-based spans)", () => {
    const parsed = layoutSchema.parse({
      sections: [
        { id: "apps", span: 6 },
        { id: "bookmarks", width: "third" },
      ],
    });
    expect(parsed.sections.find((w) => w.id === "apps")?.span).toBe(12);
    expect(parsed.sections.find((w) => w.id === "bookmarks")?.span).toBe(8);
  });

  it("keeps a valid scale and coerces an out-of-range one to the default", () => {
    expect(layoutSchema.parse({ scale: 120, columns: 24 }).scale).toBe(120);
    expect(layoutSchema.parse({ scale: 500, columns: 24 }).scale).toBe(100);
    expect(layoutSchema.parse({ scale: "big", columns: 24 }).scale).toBe(100);
  });

  it("keeps a valid cards override and drops an invalid one", () => {
    const parsed = layoutSchema.parse({
      sections: [
        { id: "apps", span: 24, cards: 3 },
        { id: "bookmarks", span: 24, cards: 9 },
      ],
      columns: 24,
    });
    expect(parsed.sections[0]).toEqual({ id: "apps", span: 24, cards: 3 });
    expect(parsed.sections[1]).toEqual({ id: "bookmarks", span: 24 });
  });

  it("keeps a valid per-side space and migrates a legacy spaceBelow", () => {
    const parsed = layoutSchema.parse({
      sections: [
        { id: "apps", span: 24, space: { top: 24, bottom: 16 } },
        { id: "bookmarks", span: 24, spaceBelow: 40 }, // legacy → space.bottom
        { id: "feed", span: 24, space: { top: 0 } }, // no valid side — dropped
      ],
      columns: 24,
    });
    expect(parsed.sections[0]).toEqual({
      id: "apps",
      span: 24,
      space: { top: 24, bottom: 16 },
    });
    expect(parsed.sections[1]).toEqual({
      id: "bookmarks",
      span: 24,
      space: { bottom: 40 },
    });
    expect(parsed.sections[2]).toEqual({ id: "feed", span: 24 });
  });

  it("keeps hidden absent when a stored entry omits it, present when not", () => {
    const parsed = layoutSchema.parse({
      sections: [
        { id: "apps", span: 6 },
        { id: "search", span: 12, hidden: true },
      ],
    });
    expect("hidden" in parsed.sections[0]).toBe(false);
    expect(parsed.sections[1].hidden).toBe(true);
  });

  it("drops only the malformed rows, keeping the good ones", () => {
    const parsed = layoutSchema.parse({
      sections: [
        { id: "not-a-widget" },
        { id: "apps", span: 6 },
        "garbage",
      ],
      columns: 24,
    });
    expect(parsed.sections).toEqual([{ id: "apps", span: 6 }]);
    // The resolver then rebuilds the rest around what survived.
    const resolved = resolveLayoutWidgets(parsed.sections);
    expect(resolved.map((w) => w.id).sort()).toEqual(
      [...LAYOUT_WIDGET_IDS].sort()
    );
  });

  it("layoutUpdateSchema requires a fully-resolved list and bounds span/cards/scale", () => {
    const good = {
      sections: [
        {
          id: "apps",
          span: 13,
          hidden: false,
          cards: 4,
          hideLabel: true,
          height: 320,
          space: { top: 24, bottom: 40 },
        },
      ],
      gap: 48,
    };
    const parsed = layoutUpdateSchema.safeParse(good);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.sections[0].hideLabel).toBe(true);
    expect(parsed.data?.sections[0].height).toBe(320);
    expect(parsed.data?.sections[0].space).toEqual({ top: 24, bottom: 40 });
    expect(parsed.data?.gap).toBe(48);
    // The grid marker and scale are stamped in so a stored layout can never
    // re-trigger the 12→24 migration.
    expect(parsed.data?.columns).toBe(24);
    expect(parsed.data?.scale).toBe(100);
    for (const bad of [
      { sections: [{ id: "apps", span: 0, hidden: false }] },
      { sections: [{ id: "apps", span: 25, hidden: false }] },
      { sections: [{ id: "apps", span: 6 }] }, // hidden required
      { sections: [{ id: "apps", width: "half", hidden: false }] }, // legacy shape rejected
      { sections: [{ id: "apps", span: 6, hidden: false, cards: 5 }] },
      { sections: [{ id: "apps", span: 6, hidden: false, height: 40 }] }, // below min
      { sections: [{ id: "apps", span: 6, hidden: false, space: { top: 0 } }] }, // side below min
      { sections: [{ id: "apps", span: 6, hidden: false, space: { top: 99999 } }] }, // side above max
      { sections: [], scale: 500 },
      { sections: [], gap: 999 }, // gap out of range
    ]) {
      expect(layoutUpdateSchema.safeParse(bad).success).toBe(false);
    }
  });
});
