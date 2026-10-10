import { describe, it, expect } from "vitest";
import { migrateV2toV3 } from "./config-migrate-v3";
import { migrateConfig } from "./config-migrate";
import { configReadSchema } from "./schema";
import { resolveLayout } from "./layout";

// The v2 → v3 step (#297): widget content moves onto instances, and the v2
// layout is resolved once with its legacy rules (ported from the 2.x
// resolveLayoutWidgets tests).

type Out = {
  settings: Record<string, unknown> & { layout: Record<string, unknown> };
  boards: { id: string; name: string; visibility: string; layout: { columns: number; sections: unknown[] } }[];
  widgets: ({ id: string; type: string } & Record<string, unknown>)[];
};
const migrate = (settings: Record<string, unknown>) =>
  migrateV2toV3({ settings }).value as unknown as Out;
const rows = (out: Out) =>
  out.boards[0].layout.sections as unknown as ({ widget: string; span: number; hidden: boolean } & Record<
    string,
    unknown
  >)[];
const row = (out: Out, widget: string) => rows(out).find((r) => r.widget === widget);
const ALL = [
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
];

describe("migrateV2toV3: layout", () => {
  it("gives a v2 config with no layout the stock arrangement over the stock instances", () => {
    const out = migrate({});
    expect(rows(out).map((r) => r.widget)).toEqual(ALL);
    expect(out.widgets.map((w) => [w.id, w.type])).toEqual(ALL.map((t) => [t, t]));
  });

  it("keeps saved order/span/hidden, prepends missing header widgets and appends the rest", () => {
    const out = migrate({
      layout: {
        sections: [
          { id: "bookmarks", span: 6, hidden: false },
          { id: "apps", span: 6, hidden: true },
        ],
      },
    });
    expect(rows(out).map((r) => r.widget)).toEqual([
      "greeting",
      "headerCard",
      "clock",
      "weather",
      "status",
      "bookmarks",
      "apps",
      "search",
      "calendar",
      "notes",
      "feed",
      "countdown",
      "worldClocks",
      "systemStats",
      "favorites",
    ]);
    expect(row(out, "bookmarks")).toMatchObject({ span: 6, hidden: false });
    expect(row(out, "apps")).toMatchObject({ span: 6, hidden: true });
  });

  it("drops unknown ids and duplicates, and fixes a bad span to the default", () => {
    const out = migrate({
      layout: {
        sections: [
          { id: "apps", span: 6 },
          { id: "apps", span: 12 },
          { id: "nope", span: 6 },
          { id: "search", span: 25 },
        ],
      },
    });
    expect(row(out, "apps")?.span).toBe(6);
    expect(row(out, "search")?.span).toBe(24);
    expect(rows(out).some((r) => r.widget === "nope")).toBe(false);
    expect(rows(out)).toHaveLength(ALL.length);
  });

  it("carries per-row tweaks through", () => {
    const out = migrate({
      layout: { sections: [{ id: "apps", span: 24, cards: 4, hideLabel: true, height: 320, space: { top: 8 } }] },
    });
    expect(row(out, "apps")).toMatchObject({ cards: 4, hideLabel: true, height: 320, space: { top: 8 } });
    expect(row(out, "apps")).not.toHaveProperty("id");
  });

  it("folds the legacy components toggles into hidden, an explicit hidden winning", () => {
    const out = migrate({
      components: { greeting: false, apps: false, bookmarks: false },
      layout: {
        sections: [
          { id: "apps", span: 24 },
          { id: "bookmarks", span: 24, hidden: false },
        ],
      },
    });
    expect(row(out, "apps")?.hidden).toBe(true);
    expect(row(out, "greeting")?.hidden).toBe(true);
    expect(row(out, "bookmarks")?.hidden).toBe(false);
    expect(row(out, "favorites")?.hidden).toBe(false);
  });

  it("keeps placed feed cards by id and appends unplaced ones hidden", () => {
    const out = migrate({
      feeds: [
        { id: "a", enabled: true, urls: ["https://a.test/feed"] },
        { id: "b", enabled: true, urls: [] },
        { id: "c", enabled: true },
      ],
      layout: {
        sections: [
          { id: "feed", instanceId: "b", span: 12, hidden: false },
          { id: "feed", instanceId: "gone", span: 8, hidden: false },
          { id: "feed", span: 8, hidden: false },
        ],
      },
    });
    const feeds = rows(out).filter((r) => ["a", "b", "c"].includes(r.widget));
    expect(feeds.map((r) => [r.widget, r.span, r.hidden])).toEqual([
      ["b", 12, false],
      ["a", 8, true],
      ["c", 8, true],
    ]);
    expect(out.widgets.filter((w) => w.type === "feed").map((w) => w.id)).toEqual(["a", "b", "c"]);
  });
});

describe("migrateV2toV3: content", () => {
  it("moves each widget's settings onto its instance and removes the old keys", () => {
    const out = migrate({
      notes: { title: "Todo", content: "milk" },
      countdown: { title: "Soon", items: [{ label: "Trip", date: "2026-12-01" }] },
      worldClocks: { title: "Clocks", items: [{ label: "", timeZone: "Asia/Tokyo" }] },
      systemStats: { title: "Box", disks: [{ label: "Media", path: "/mnt" }] },
      calendar: { enabled: true, url: "https://cal.test/a.ics", username: "u", password: "p" },
    });
    const byId = Object.fromEntries(out.widgets.map((w) => [w.id, w]));
    expect(byId.notes).toMatchObject({ type: "notes", title: "Todo", content: "milk" });
    expect(byId.countdown).toMatchObject({ items: [{ label: "Trip", date: "2026-12-01" }] });
    expect(byId.worldClocks).toMatchObject({ items: [{ timeZone: "Asia/Tokyo" }] });
    expect(byId.systemStats).toMatchObject({ disks: [{ path: "/mnt" }] });
    expect(byId.calendar).toMatchObject({ url: "https://cal.test/a.ics", username: "u", password: "p" });
    for (const key of ["notes", "countdown", "worldClocks", "systemStats", "calendar", "feeds", "components"]) {
      expect(out.settings).not.toHaveProperty(key);
    }
  });

  it("moves the clock and menu switches", () => {
    const out = migrate({ components: { clock: false, settingsButton: false }, layout: { sections: [{ id: "clock", span: 8, hidden: false }] } });
    expect(out.widgets.find((w) => w.id === "headerCard")).toMatchObject({ showClock: false });
    // v2's clock widget showed nothing with the clock off: hidden, not shown.
    expect(row(out, "clock")?.hidden).toBe(true);
    expect(out.settings.settingsButton).toBe(false);
  });

  it("hides a feed card or calendar that v2 had switched off", () => {
    const out = migrate({
      calendar: { enabled: false, url: "https://cal.test/a.ics" },
      feeds: [
        { id: "on", enabled: true },
        { id: "off", enabled: false },
      ],
      layout: {
        sections: [
          { id: "calendar", span: 24, hidden: false },
          { id: "feed", instanceId: "on", span: 8, hidden: false },
          { id: "feed", instanceId: "off", span: 8, hidden: false },
        ],
      },
    });
    expect(row(out, "calendar")?.hidden).toBe(true);
    expect(row(out, "on")?.hidden).toBe(false);
    expect(row(out, "off")?.hidden).toBe(true);
  });

  it("makes a feed id URL-safe, keeping the layout bound to it", () => {
    const out = migrate({
      feeds: [{ id: "my news!", enabled: true }],
      layout: { sections: [{ id: "feed", instanceId: "my news!", span: 12, hidden: false }] },
    });
    expect(out.widgets.find((w) => w.type === "feed")?.id).toBe("my-news");
    expect(row(out, "my-news")).toMatchObject({ span: 12, hidden: false });
  });

  it("leaves a config with boards alone", () => {
    const raw = { settings: {}, boards: [], widgets: [] };
    expect(migrateV2toV3(raw)).toEqual({ value: raw, changed: false });
  });
});

describe("migrateV2toV3: boards (#298)", () => {
  it("makes the v2 layout the public home board, leaving scale and spacing in settings", () => {
    const out = migrate({
      layout: { columns: 24, scale: 110, gap: 24, topGap: 40, sections: [{ id: "apps", span: 12 }] },
    });
    expect(out.boards).toHaveLength(1);
    expect(out.boards[0]).toMatchObject({ id: "home", name: "Home", visibility: "public" });
    expect(out.boards[0].layout.columns).toBe(24);
    expect(row(out, "apps")).toMatchObject({ span: 12 });
    expect(out.settings.layout).toEqual({ scale: 110, gap: 24, topGap: 40 });
  });

  it("moves a 3.0 pre-release file's rows into a board, and only that", () => {
    const sections = [{ widget: "notes", span: 12, hidden: false }];
    const raw = {
      schemaVersion: 3,
      settings: { title: "Mine", layout: { columns: 24, gap: 16, sections } },
      widgets: [{ id: "notes", type: "notes" }],
    };
    const { value, changed } = migrateV2toV3(raw);
    const out = value as Out;
    expect(changed).toBe(true);
    expect(out.widgets).toBe(raw.widgets);
    expect(out.settings).toEqual({ title: "Mine", layout: { gap: 16 } });
    expect(out.boards[0].layout.sections).toEqual(sections);
  });

  it("leaves a v3 file with no saved rows alone: the default home board is stock", () => {
    const raw = { schemaVersion: 3, settings: { title: "Mine", layout: { gap: 16 } } };
    expect(migrateV2toV3(raw)).toEqual({ value: raw, changed: false });
    const config = configReadSchema.parse(raw);
    expect(config.boards.map((b) => b.id)).toEqual(["home"]);
    expect(resolveLayout(config.boards[0].layout.sections, config.widgets).map((w) => w.id)).toEqual(ALL);
  });
});

describe("the v2 → v3 chain", () => {
  it("stamps 3 and produces a config that reads back as the same board", () => {
    const { value, changed } = migrateConfig({
      schemaVersion: 2,
      settings: {
        notes: { title: "Todo", content: "milk" },
        // `columns: 24` marks the spans as already on the 24-column grid.
        layout: { columns: 24, sections: [{ id: "notes", span: 12, hidden: false }] },
      },
    });
    expect(changed).toBe(true);
    const config = configReadSchema.parse(value);
    expect(config.schemaVersion).toBe(3);
    const board = resolveLayout(config.boards[0].layout.sections, config.widgets);
    expect(board.find((w) => w.id === "notes")).toMatchObject({ type: "notes", span: 12, hidden: false });
    expect(config.widgets.find((w) => w.id === "notes")).toMatchObject({ content: "milk" });
  });

  it("migrates a pre-2.1 single feed all the way to an instance", () => {
    const { value } = migrateConfig({
      settings: {
        feed: { enabled: true, url: "https://x.test/rss" },
        layout: { columns: 24, sections: [{ id: "feed", span: 12 }] },
      },
    });
    const config = configReadSchema.parse(value);
    expect(config.widgets.find((w) => w.type === "feed")).toMatchObject({
      id: "feed",
      urls: ["https://x.test/rss"],
    });
    const feedRow = resolveLayout(config.boards[0].layout.sections, config.widgets).find(
      (w) => w.type === "feed"
    );
    expect(feedRow).toMatchObject({ span: 12, hidden: false });
  });
});
