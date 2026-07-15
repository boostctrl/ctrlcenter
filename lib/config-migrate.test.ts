import { describe, it, expect } from "vitest";
import { migrateConfigShape } from "./config-migrate";

describe("migrateConfigShape", () => {
  it("reports a current-shape config unchanged, value untouched", () => {
    const modern = {
      settings: {
        feed: { enabled: true, urls: ["https://a.example/rss"], count: 6, title: "" },
        layout: {
          sections: [{ id: "apps", span: 12, hidden: false }],
          columns: 24,
        },
      },
      apps: [],
    };
    const { value, changed } = migrateConfigShape(modern);
    expect(changed).toBe(false);
    expect(value).toBe(modern); // same reference — nothing was rebuilt
  });

  it("leaves a non-object or settings-less input alone", () => {
    expect(migrateConfigShape(null)).toEqual({ value: null, changed: false });
    expect(migrateConfigShape("nope").changed).toBe(false);
    expect(migrateConfigShape({ apps: [] }).changed).toBe(false);
  });

  describe("feed url → urls", () => {
    it("folds a legacy single url into the urls list and drops the key", () => {
      const { value, changed } = migrateConfigShape({
        settings: { feed: { enabled: true, url: "https://old.example/rss" } },
      }) as { value: { settings: { feed: Record<string, unknown> } }; changed: boolean };
      expect(changed).toBe(true);
      expect(value.settings.feed.urls).toEqual(["https://old.example/rss"]);
      expect("url" in value.settings.feed).toBe(false);
    });

    it("prefers a populated urls list; the stale url is simply dropped", () => {
      const { value, changed } = migrateConfigShape({
        settings: {
          feed: { url: "https://stale.example/rss", urls: ["https://new.example/rss"] },
        },
      }) as { value: { settings: { feed: Record<string, unknown> } }; changed: boolean };
      expect(changed).toBe(true);
      expect(value.settings.feed.urls).toEqual(["https://new.example/rss"]);
      expect("url" in value.settings.feed).toBe(false);
    });

    it("treats a blank-only urls list as empty, so the url still folds in", () => {
      const { value } = migrateConfigShape({
        settings: { feed: { url: "https://old.example/rss", urls: ["  ", ""] } },
      }) as { value: { settings: { feed: Record<string, unknown> } } };
      expect(value.settings.feed.urls).toEqual(["https://old.example/rss"]);
    });

    it("drops a blank url key without inventing a feed (every 1.9.x write stamped url: '')", () => {
      const { value, changed } = migrateConfigShape({
        settings: { feed: { enabled: false, url: "", urls: [] } },
      }) as { value: { settings: { feed: Record<string, unknown> } }; changed: boolean };
      expect(changed).toBe(true);
      expect("url" in value.settings.feed).toBe(false);
      expect(value.settings.feed.urls).toEqual([]);
    });
  });

  describe("12-column spans → 24", () => {
    it("doubles plausible 12-based spans when the columns marker is missing", () => {
      const { value, changed } = migrateConfigShape({
        settings: {
          layout: {
            sections: [
              { id: "apps", span: 6, hidden: false },
              { id: "search", span: 12 },
            ],
          },
        },
      }) as { value: { settings: { layout: Record<string, unknown> } }; changed: boolean };
      expect(changed).toBe(true);
      expect(value.settings.layout.sections).toEqual([
        { id: "apps", span: 12, hidden: false },
        { id: "search", span: 24 },
      ]);
      expect(value.settings.layout.columns).toBe(24);
    });

    it("leaves spans alone when the marker already says 24", () => {
      const { changed } = migrateConfigShape({
        settings: {
          layout: { sections: [{ id: "apps", span: 6 }], columns: 24 },
        },
      });
      expect(changed).toBe(false);
    });

    it("only doubles plausible 12-grid spans; others pass through for validation", () => {
      const { value } = migrateConfigShape({
        settings: {
          layout: {
            sections: [
              { id: "apps", span: 13 }, // already 24-based — untouched
              { id: "search", span: 2.5 }, // not an integer — untouched
              "garbage", // non-object row — untouched
            ],
          },
        },
      }) as { value: { settings: { layout: { sections: unknown[] } } } };
      expect(value.settings.layout.sections).toEqual([
        { id: "apps", span: 13 },
        { id: "search", span: 2.5 },
        "garbage",
      ]);
    });
  });

  describe("section width → span", () => {
    it("maps each legacy width to its 24-column span and drops the key", () => {
      const { value, changed } = migrateConfigShape({
        settings: {
          layout: {
            sections: [
              { id: "search", width: "full" },
              { id: "apps", width: "twoThirds" },
              { id: "bookmarks", width: "half" },
              { id: "calendar", width: "third" },
            ],
            columns: 24,
          },
        },
      }) as { value: { settings: { layout: { sections: Record<string, unknown>[] } } }; changed: boolean };
      expect(changed).toBe(true);
      expect(value.settings.layout.sections).toEqual([
        { id: "search", span: 24 },
        { id: "apps", span: 16 },
        { id: "bookmarks", span: 12 },
        { id: "calendar", span: 8 },
      ]);
    });

    it("does not double a width-derived span (widths are already 24-based)", () => {
      // No columns marker: spans double, widths map straight across.
      const { value } = migrateConfigShape({
        settings: {
          layout: {
            sections: [
              { id: "apps", span: 6 },
              { id: "bookmarks", width: "third" },
            ],
          },
        },
      }) as { value: { settings: { layout: { sections: Record<string, unknown>[] } } } };
      expect(value.settings.layout.sections).toEqual([
        { id: "apps", span: 12 },
        { id: "bookmarks", span: 8 },
      ]);
    });

    it("lets a valid explicit span win over a width on the same row", () => {
      const { value } = migrateConfigShape({
        settings: {
          layout: {
            sections: [{ id: "apps", span: 20, width: "third" }],
            columns: 24,
          },
        },
      }) as { value: { settings: { layout: { sections: Record<string, unknown>[] } } } };
      expect(value.settings.layout.sections).toEqual([{ id: "apps", span: 20 }]);
    });

    it("drops an unknown width value without inventing a span", () => {
      const { value, changed } = migrateConfigShape({
        settings: {
          layout: {
            sections: [{ id: "apps", width: "banana" }],
            columns: 24,
          },
        },
      }) as { value: { settings: { layout: { sections: Record<string, unknown>[] } } }; changed: boolean };
      expect(changed).toBe(true);
      expect(value.settings.layout.sections).toEqual([{ id: "apps" }]);
    });
  });

  describe("section spaceBelow → space.bottom", () => {
    it("moves a valid spaceBelow into space.bottom and drops the key", () => {
      const { value, changed } = migrateConfigShape({
        settings: {
          layout: {
            sections: [{ id: "apps", span: 24, spaceBelow: 40 }],
            columns: 24,
          },
        },
      }) as { value: { settings: { layout: { sections: Record<string, unknown>[] } } }; changed: boolean };
      expect(changed).toBe(true);
      expect(value.settings.layout.sections).toEqual([
        { id: "apps", span: 24, space: { bottom: 40 } },
      ]);
    });

    it("lets a space object with any valid side win whole over spaceBelow", () => {
      const { value } = migrateConfigShape({
        settings: {
          layout: {
            sections: [{ id: "feed", span: 24, space: { top: 8 }, spaceBelow: 40 }],
            columns: 24,
          },
        },
      }) as { value: { settings: { layout: { sections: Record<string, unknown>[] } } } };
      expect(value.settings.layout.sections).toEqual([
        { id: "feed", span: 24, space: { top: 8 } },
      ]);
    });

    it("drops an out-of-range spaceBelow without converting it", () => {
      const { value } = migrateConfigShape({
        settings: {
          layout: {
            sections: [{ id: "apps", span: 24, spaceBelow: 0 }],
            columns: 24,
          },
        },
      }) as { value: { settings: { layout: { sections: Record<string, unknown>[] } } } };
      expect(value.settings.layout.sections).toEqual([{ id: "apps", span: 24 }]);
    });
  });

  it("is idempotent: a second pass over the output reports no change", () => {
    const legacy = {
      settings: {
        feed: { url: "https://old.example/rss" },
        layout: {
          sections: [
            { id: "apps", span: 6, spaceBelow: 16 },
            { id: "bookmarks", width: "half" },
          ],
        },
      },
    };
    const once = migrateConfigShape(legacy);
    expect(once.changed).toBe(true);
    const twice = migrateConfigShape(once.value);
    expect(twice.changed).toBe(false);
    expect(twice.value).toBe(once.value);
  });

  it("never mutates its input", () => {
    const legacy = {
      settings: {
        feed: { url: "https://old.example/rss", urls: [] },
        layout: { sections: [{ id: "apps", width: "half", spaceBelow: 8 }] },
      },
    };
    const snapshot = JSON.parse(JSON.stringify(legacy));
    migrateConfigShape(legacy);
    expect(legacy).toEqual(snapshot);
  });

  it("carries unknown keys and malformed rows through untouched", () => {
    // The persist path writes this object back to disk WITHOUT schema
    // validation, so anything the lenient read would drop in memory must
    // survive the rewrite on disk — an unprompted background write can't be
    // allowed to destroy data an admin didn't ask to change.
    const { value } = migrateConfigShape({
      futureTopLevel: { anything: true },
      settings: {
        feed: { url: "https://old.example/rss", customFlag: 7 },
        layout: {
          sections: [{ id: "apps", width: "half", someday: "maybe" }],
          experiment: "keep-me",
        },
        unknownSetting: "stays",
      },
      apps: [{ id: "broken", name: "" }], // lenient read drops it; disk keeps it
    }) as {
      value: {
        futureTopLevel: unknown;
        apps: unknown;
        settings: {
          unknownSetting: unknown;
          feed: Record<string, unknown>;
          layout: { experiment: unknown; sections: Record<string, unknown>[] };
        };
      };
    };
    expect(value.futureTopLevel).toEqual({ anything: true });
    expect(value.settings.unknownSetting).toBe("stays");
    expect(value.settings.feed.customFlag).toBe(7);
    expect(value.settings.layout.experiment).toBe("keep-me");
    expect(value.settings.layout.sections[0].someday).toBe("maybe");
    expect(value.apps).toEqual([{ id: "broken", name: "" }]);
  });
});
