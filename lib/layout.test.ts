import { describe, it, expect } from "vitest";
import { resolveLayout, toSections, fillSpan, DEFAULT_SECTIONS } from "./layout";
import {
  settingsSchema,
  configSchema,
  layoutSchema,
  boardLayoutSchema,
  boardLayoutUpdateSchema,
  DEFAULT_INSTANCES,
} from "./schema";

// Instances named after their type, as a fresh config has.
const STOCK = DEFAULT_INSTANCES.map(({ id, type }) => ({ id, type }));

describe("resolveLayout (#297)", () => {
  it("gives the stock arrangement for the stock rows and instances", () => {
    const out = resolveLayout(DEFAULT_SECTIONS, STOCK);
    expect(out.map((w) => w.id)).toEqual(STOCK.map((w) => w.id));
    expect(out.find((w) => w.id === "notes")).toEqual({ id: "notes", type: "notes", span: 8, hidden: true });
  });

  it("binds each row to its instance and type, in saved order", () => {
    const out = resolveLayout(
      [
        { widget: "n2", span: 6, hidden: false },
        { widget: "n1", span: 12, hidden: true },
      ],
      [
        { id: "n1", type: "notes" },
        { id: "n2", type: "notes" },
      ]
    );
    expect(out).toEqual([
      { id: "n2", type: "notes", span: 6, hidden: false },
      { id: "n1", type: "notes", span: 12, hidden: true },
    ]);
  });

  it("appends every instance no row places, hidden at its type's default span", () => {
    const out = resolveLayout([{ widget: "apps", span: 24, hidden: false }], [
      { id: "apps", type: "apps" },
      { id: "notes-2", type: "notes" },
    ]);
    expect(out[1]).toEqual({ id: "notes-2", type: "notes", span: 8, hidden: true });
  });

  it("skips rows for missing instances and repeats, and fixes bad values", () => {
    const out = resolveLayout(
      [
        { widget: "gone", span: 6, hidden: false },
        { widget: "apps", span: 25, hidden: "no" },
        { widget: "apps", span: 6, hidden: false },
        { span: 6 },
      ],
      [{ id: "apps", type: "apps" }]
    );
    expect(out).toEqual([{ id: "apps", type: "apps", span: 24, hidden: false }]);
  });

  it("keeps valid placement tweaks and drops invalid ones", () => {
    const inst = [
      { id: "a", type: "apps" as const },
      { id: "b", type: "bookmarks" as const },
    ];
    const [a, b] = resolveLayout(
      [
        { widget: "a", span: 24, cards: 4, hideLabel: true, height: 320, space: { top: 24, bottom: 16 } },
        { widget: "b", span: 24, cards: 0, hideLabel: "yes", height: 50, space: { left: 8, right: 0, top: 99999 } },
      ],
      inst
    );
    expect(a).toMatchObject({ cards: 4, hideLabel: true, height: 320, space: { top: 24, bottom: 16 } });
    expect(b).toEqual({ id: "b", type: "bookmarks", span: 24, hidden: false, space: { left: 8 } });
  });

  it("round-trips through toSections", () => {
    const out = resolveLayout(DEFAULT_SECTIONS, STOCK);
    expect(resolveLayout(toSections(out), STOCK)).toEqual(out);
    expect(toSections(out)[0]).toEqual({ widget: "greeting", span: 16, hidden: false });
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
  it("a fresh config has one public home board with the full widget catalog", () => {
    const config = configSchema.parse({});
    expect(config.boards).toHaveLength(1);
    expect(config.boards[0]).toMatchObject({ id: "home", name: "Home", visibility: "public" });
    expect(config.boards[0].layout.sections).toEqual(DEFAULT_SECTIONS);
    expect(config.boards[0].layout).not.toHaveProperty("columns");
    expect(settingsSchema.parse({}).layout).toEqual({ scale: 100, gap: 32, topGap: 64 });
  });

  it("parses spans as-is and re-parses idempotently (pre-24 shapes are the migration's job)", () => {
    const once = boardLayoutSchema.parse({
      sections: [{ widget: "apps", span: 7 }],
      columns: 24,
    });
    expect(once.sections).toEqual([{ widget: "apps", span: 7 }]);
    // Re-parsing the output (as writeConfig does) is a no-op.
    expect(boardLayoutSchema.parse(once)).toEqual(once);
  });

  it("keeps a valid scale and coerces an out-of-range one to the default", () => {
    expect(layoutSchema.parse({ scale: 120 }).scale).toBe(120);
    expect(layoutSchema.parse({ scale: 500 }).scale).toBe(100);
    expect(layoutSchema.parse({ scale: "big" }).scale).toBe(100);
  });

  it("keeps a valid cards override and drops an invalid one", () => {
    const parsed = boardLayoutSchema.parse({
      sections: [
        { widget: "apps", span: 24, cards: 3 },
        { widget: "bookmarks", span: 24, cards: 9 },
      ],
      columns: 24,
    });
    expect(parsed.sections[0]).toEqual({ widget: "apps", span: 24, cards: 3 });
    expect(parsed.sections[1]).toEqual({ widget: "bookmarks", span: 24 });
  });

  it("keeps a valid per-side space and drops one with no valid side", () => {
    const parsed = boardLayoutSchema.parse({
      sections: [
        { widget: "apps", span: 24, space: { top: 24, bottom: 16 } },
        { widget: "feed", span: 24, space: { top: 0 } }, // no valid side — dropped
      ],
      columns: 24,
    });
    expect(parsed.sections[0]).toEqual({
      widget: "apps",
      span: 24,
      space: { top: 24, bottom: 16 },
    });
    expect(parsed.sections[1]).toEqual({ widget: "feed", span: 24 });
  });

  it("keeps hidden absent when a stored entry omits it, present when not", () => {
    const parsed = boardLayoutSchema.parse({
      sections: [
        { widget: "apps", span: 6 },
        { widget: "search", span: 12, hidden: true },
      ],
    });
    expect("hidden" in parsed.sections[0]).toBe(false);
    expect(parsed.sections[1].hidden).toBe(true);
  });

  it("drops only the malformed rows, keeping the good ones", () => {
    const parsed = boardLayoutSchema.parse({
      sections: [
        { id: "apps" }, // the v2 shape: no `widget`
        { widget: "apps", span: 6 },
        "garbage",
      ],
      columns: 24,
    });
    expect(parsed.sections).toEqual([{ widget: "apps", span: 6 }]);
    // The resolver then adds every unplaced instance around what survived.
    const resolved = resolveLayout(parsed.sections, STOCK);
    expect(resolved.map((w) => w.id).sort()).toEqual(STOCK.map((w) => w.id).sort());
  });

  it("boardLayoutUpdateSchema bounds every row value and the page-level ones", () => {
    const good = {
      sections: [
        {
          widget: "apps",
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
    const parsed = boardLayoutUpdateSchema.safeParse(good);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.sections[0].hideLabel).toBe(true);
    expect(parsed.data?.sections[0].height).toBe(320);
    expect(parsed.data?.sections[0].space).toEqual({ top: 24, bottom: 40 });
    expect(parsed.data?.gap).toBe(48);
    // Left out, the scale stays as stored.
    expect(parsed.data?.scale).toBeUndefined();
    for (const bad of [
      { sections: [{ widget: "apps", span: 0, hidden: false }] },
      { sections: [{ widget: "apps", span: 25, hidden: false }] },
      { sections: [{ id: "apps", span: 6, hidden: false }] }, // v2 shape rejected
      { sections: [{ widget: "apps", span: 6, hidden: false, cards: 5 }] },
      { sections: [{ widget: "apps", span: 6, hidden: false, height: 40 }] }, // below min
      { sections: [{ widget: "apps", span: 6, hidden: false, space: { top: 0 } }] }, // side below min
      { sections: [{ widget: "apps", span: 6, hidden: false, space: { top: 99999 } }] }, // side above max
      { sections: [], scale: 500 },
      { sections: [], gap: 999 }, // gap out of range
    ]) {
      expect(boardLayoutUpdateSchema.safeParse(bad).success).toBe(false);
    }
  });
});
