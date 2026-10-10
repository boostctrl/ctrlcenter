import { describe, it, expect } from "vitest";
import { migrateV2toV3 } from "./config-migrate-v3";
import { migrateConfig } from "./config-migrate";
import { configReadSchema } from "./schema";
import { resolveLayout } from "./layout";
import { THEME_PACKS } from "./theme";

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
    const raw = { schemaVersion: 3, settings: {}, boards: [], widgets: [] };
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
    expect(out.boards[0].layout).not.toHaveProperty("columns");
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

describe("migrateV2toV3: groups (#299)", () => {
  type G = { groups: { id: string; name: string }[]; bookmarks: Record<string, unknown>[]; settings: Record<string, unknown> };
  const run = (raw: Record<string, unknown>) => migrateV2toV3(raw).value as unknown as Out & G;

  it("turns bookmark categories into groups in the saved order, then first-seen", () => {
    const out = run({
      settings: { bookmarkCategoryOrder: ["Media", "Gone", "Dev"] },
      bookmarks: [
        { id: "1", category: "Dev", name: "GitHub", url: "https://github.com" },
        { id: "2", category: "Shopping", name: "Amazon", url: "https://amazon.com" },
        { id: "3", category: "Media", name: "Plex", url: "https://plex.tv" },
        { id: "4", category: "Media & TV", name: "Jelly", url: "https://jelly.tv" },
      ],
    });
    expect(out.groups).toEqual([
      { id: "media", name: "Media" },
      { id: "dev", name: "Dev" },
      { id: "shopping", name: "Shopping" },
      { id: "media-tv", name: "Media & TV" },
    ]);
    expect(out.bookmarks.map((b) => b.group)).toEqual(["dev", "shopping", "media", "media-tv"]);
    expect(out.bookmarks.every((b) => !("category" in b))).toBe(true);
    expect(out.settings).not.toHaveProperty("bookmarkCategoryOrder");
    const config = configReadSchema.parse(migrateConfig({ schemaVersion: 2, settings: {}, bookmarks: out.bookmarks }).value);
    expect(config.bookmarks).toHaveLength(4);
  });

  it("keeps two categories whose names make the same id apart", () => {
    const out = run({
      bookmarks: [
        { id: "1", category: "Media", name: "A", url: "https://a.com" },
        { id: "2", category: "media", name: "B", url: "https://b.com" },
      ],
    });
    expect(out.groups.map((g) => g.id)).toEqual(["media", "media-2"]);
  });

  it("makes groupPrivateApps a second apps widget beside each apps row", () => {
    const out = run({
      settings: {
        groupPrivateApps: true,
        layout: { columns: 24, sections: [{ id: "apps", span: 12, cards: 3 }] },
      },
    });
    const apps = out.widgets.filter((w) => w.type === "apps");
    expect(apps).toEqual([
      expect.objectContaining({ id: "apps", filter: { private: "hide" } }),
      expect.objectContaining({ id: "apps-private", title: "Private Applications", filter: { private: "only" } }),
    ]);
    const ids = rows(out).map((r) => r.widget);
    expect(ids.indexOf("apps-private")).toBe(ids.indexOf("apps") + 1);
    expect(row(out, "apps-private")).toMatchObject({ span: 12, cards: 3, hidden: false });
    expect(out.settings).not.toHaveProperty("groupPrivateApps");
  });

  it("drops a groupPrivateApps that was off without adding a widget", () => {
    const out = run({ settings: { groupPrivateApps: false } });
    expect(out.widgets.filter((w) => w.type === "apps").map((w) => w.id)).toEqual(["apps"]);
    expect(out.settings).not.toHaveProperty("groupPrivateApps");
  });

  it("gives a pre-release file with boards just the groups part, and leaves a current one alone", () => {
    const pre = {
      schemaVersion: 3,
      settings: {},
      boards: [{ id: "home" }],
      widgets: [],
      bookmarks: [{ id: "1", category: "Dev", name: "GitHub", url: "https://github.com" }],
    };
    const out = migrateV2toV3(pre);
    expect(out.changed).toBe(true);
    expect((out.value as G).groups).toEqual([{ id: "dev", name: "Dev" }]);
    const current = { ...pre, groups: [], bookmarks: [] };
    expect(migrateV2toV3(current)).toEqual({ value: current, changed: false });
  });
});

describe("migrateV2toV3: integrations (#300)", () => {
  it("turns each set-up fixed key into an integration with the service's id, dropping the rest", () => {
    const out = migrateV2toV3({
      settings: {
        integrations: {
          sonarr: { enabled: true, url: "http://sonarr.lan", apiKey: "k" },
          radarr: { enabled: false, url: "http://radarr.lan", apiKey: "" },
          tautulli: { enabled: false, url: "", apiKey: "" },
          unifi: { enabled: true, url: "", username: "u", password: "p", allowInsecureTls: true },
          bogus: { enabled: true, url: "http://x" },
        },
      },
    }).value as Out & { integrations: Record<string, unknown>[] };
    expect(out.integrations.map((i) => [i.id, i.type, i.enabled])).toEqual([
      ["sonarr", "sonarr", true],
      ["radarr", "radarr", false],
      ["unifi", "unifi", true],
    ]);
    expect(out.integrations[2]).toMatchObject({ username: "u", password: "p", allowInsecureTls: true });
    expect(out.settings).not.toHaveProperty("integrations");
    const config = configReadSchema.parse(migrateConfig({ schemaVersion: 2, settings: { integrations: { sonarr: { enabled: true, url: "http://s" } } } }).value);
    expect(config.integrations).toEqual([expect.objectContaining({ id: "sonarr", type: "sonarr", url: "http://s", name: "" })]);
  });

  it("leaves a file without the old key, or with the new list, alone", () => {
    const v3 = { schemaVersion: 3, settings: {}, boards: [], groups: [], widgets: [] };
    expect(migrateV2toV3(v3)).toEqual({ value: v3, changed: false });
    const both = { ...v3, integrations: [], settings: { integrations: { sonarr: { enabled: true } } } };
    expect(migrateV2toV3(both).changed).toBe(false);
  });
});

describe("v2 → v3: themes (#305)", () => {
  it("puts retired scenes back on the default and keys the key-less overrides", () => {
    const { value, changed } = migrateV2toV3({
      settings: { theme: { scene: "mesh", sceneLight: "glow", design: "flat" } },
      themes: [
        { name: "Mariana", design: "glass", scene: "vortex" },
        { key: "Ember", name: "My Ember", design: "glass", scene: "rays" },
      ],
    });
    expect(changed).toBe(true);
    const out = value as { settings: { theme: Record<string, unknown> }; themes: Record<string, unknown>[] };
    expect(out.settings.theme).toEqual({ design: "flat" });
    const mariana = out.themes.find((t) => t.key === "Mariana");
    expect(mariana).toMatchObject({ key: "Mariana", builtin: "Mariana", name: "Mariana", scene: "aurora" });
    // One naming no built-in stays as it was, after the gallery.
    expect(out.themes[out.themes.length - 1]).toMatchObject({ key: "Ember", name: "My Ember", scene: "rays" });
    expect(migrateV2toV3(value).changed).toBe(false);
  });

  it("turns the overrides into the gallery (#334): every built-in in shipped order, the edited ones as they were", () => {
    const { value, changed } = migrateV2toV3({
      themes: [{ key: "Tide", name: "Surf", design: "flat", scene: "rays" }],
    });
    expect(changed).toBe(true);
    const out = value as { themes: Record<string, unknown>[] };
    expect(out.themes.map((t) => t.key)).toEqual(THEME_PACKS.map((p) => p.name));
    expect(out.themes.every((t) => t.builtin === t.key)).toBe(true);
    expect(out.themes.find((t) => t.key === "Tide")).toEqual({ key: "Tide", builtin: "Tide", name: "Surf", design: "flat", scene: "rays" });
    expect(out.themes.find((t) => t.key === "Default")).toEqual({ key: "Default", builtin: "Default" });
    // Empty stays empty; a gallery (naming a built-in) is left be.
    const themesOf = (raw: Record<string, unknown>) => (migrateV2toV3(raw).value as { themes: unknown }).themes;
    expect(themesOf({ themes: [] })).toEqual([]);
    const gallery = [{ key: "custom-1", name: "Mine" }, { key: "Tide", builtin: "Tide" }];
    expect(themesOf({ themes: gallery })).toEqual(gallery);
  });
});

describe("v2 → v3: alerts (#320)", () => {
  it("moves the original webhook and email into the channel list, as they sent", () => {
    const { value } = migrateV2toV3({
      settings: {
        alerts: {
          enabled: true,
          type: "discord",
          webhookUrl: " https://discord.test/hook ",
          notifyOnRecovery: false,
          email: { host: "smtp.test", from: "a@x", to: "b@y", pass: "p" },
          channels: [{ id: "tg", type: "telegram", token: "t", chatId: "1" }],
        },
      },
    });
    const alerts = (value as { settings: { alerts: Record<string, unknown> } }).settings.alerts;
    expect(Object.keys(alerts).sort()).toEqual(["channels", "enabled"]);
    expect(alerts.channels).toEqual([
      { id: "webhook", type: "webhook", enabled: true, onDown: true, onRecovery: false, onWarning: true, onWebhooks: true, format: "discord", url: "https://discord.test/hook" },
      // 2.x's email switch defaulted to off.
      { id: "email", type: "email", enabled: false, onDown: true, onRecovery: false, onWarning: true, onWebhooks: true, smtp: { host: "smtp.test", from: "a@x", to: "b@y", pass: "p" } },
      { id: "tg", type: "telegram", token: "t", chatId: "1" },
    ]);
    expect(migrateV2toV3(value).changed).toBe(false);
  });

  it("drops the keys without adding channels when nothing was set up", () => {
    const { value } = migrateV2toV3({
      settings: { alerts: { webhookUrl: "", webhookEnabled: true, email: { enabled: false, host: "" } } },
    });
    expect((value as { settings: { alerts: unknown } }).settings.alerts).toEqual({ channels: [] });
  });
});

describe("v2 → v3: first-run setup (#304)", () => {
  it("marks an upgraded 2.x install as set up, but not a 3.0 file", () => {
    const upgraded = migrateV2toV3({ schemaVersion: 2, settings: {} }).value as { settings: Record<string, unknown> };
    expect(upgraded.settings.setupComplete).toBe(true);
    const fresh = { schemaVersion: 3, settings: {}, boards: [], widgets: [] };
    expect(migrateV2toV3(fresh)).toEqual({ value: fresh, changed: false });
    // An empty config.yaml made before the first start is a new install too.
    const blank = migrateV2toV3({}).value as { settings?: Record<string, unknown> };
    expect(blank.settings?.setupComplete).toBeUndefined();
  });
});

