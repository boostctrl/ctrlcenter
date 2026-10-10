import { describe, it, expect } from "vitest";
import {
  migrateConfigShape,
  migrateConfig,
  configVersion,
  NewerConfigError,
  MIGRATIONS,
  type MigrationStep,
} from "./config-migrate";
import { CONFIG_SCHEMA_VERSION } from "./schema/config";

describe("migrateConfigShape", () => {
  it("reports a current-shape config unchanged, value untouched", () => {
    const modern = {
      settings: {
        feeds: [
          { id: "feed", enabled: true, urls: ["https://a.example/rss"], count: 6, title: "" },
        ],
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

  describe("feed → feeds (single object → list, #167)", () => {
    type FeedsShape = {
      value: {
        settings: {
          feeds: Record<string, unknown>[];
          feed?: unknown;
          layout?: { sections: Record<string, unknown>[] };
        };
      };
      changed: boolean;
    };

    it("folds the single feed into a one-instance feeds list and folds a legacy url", () => {
      const { value, changed } = migrateConfigShape({
        settings: { feed: { enabled: true, url: "https://old.example/rss" } },
      }) as FeedsShape;
      expect(changed).toBe(true);
      expect("feed" in value.settings).toBe(false);
      expect(value.settings.feeds).toHaveLength(1);
      expect(value.settings.feeds[0]).toMatchObject({
        id: "feed",
        enabled: true,
        urls: ["https://old.example/rss"],
      });
      expect("url" in value.settings.feeds[0]).toBe(false);
    });

    it("stamps the migrated instance id onto the placed feed layout entry", () => {
      const { value } = migrateConfigShape({
        settings: {
          feed: { enabled: true, urls: ["https://a.example/rss"] },
          layout: { sections: [{ id: "feed", span: 8, hidden: false }] },
        },
      }) as FeedsShape;
      expect(value.settings.layout?.sections[0]).toMatchObject({
        id: "feed",
        instanceId: "feed",
      });
    });

    it("prefers a populated urls list; the stale url is simply dropped", () => {
      const { value } = migrateConfigShape({
        settings: {
          feed: { url: "https://stale.example/rss", urls: ["https://new.example/rss"] },
        },
      }) as FeedsShape;
      expect(value.settings.feeds[0].urls).toEqual(["https://new.example/rss"]);
      expect("url" in value.settings.feeds[0]).toBe(false);
    });

    it("treats a blank-only urls list as empty, so the url still folds in", () => {
      const { value } = migrateConfigShape({
        settings: { feed: { url: "https://old.example/rss", urls: ["  ", ""] } },
      }) as FeedsShape;
      expect(value.settings.feeds[0].urls).toEqual(["https://old.example/rss"]);
    });

    it("converts a blank single feed into one empty-url instance", () => {
      const { value, changed } = migrateConfigShape({
        settings: { feed: { enabled: false, url: "", urls: [] } },
      }) as FeedsShape;
      expect(changed).toBe(true);
      expect("feed" in value.settings).toBe(false);
      expect(value.settings.feeds[0].urls).toEqual([]);
    });

    it("does not touch a config already on the feeds list shape", () => {
      const modern = {
        settings: { feeds: [{ id: "feed", enabled: true, urls: [] }] },
      };
      expect(migrateConfigShape(modern).changed).toBe(false);
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
          feeds: Record<string, unknown>[];
          layout: { experiment: unknown; sections: Record<string, unknown>[] };
        };
      };
    };
    expect(value.futureTopLevel).toEqual({ anything: true });
    expect(value.settings.unknownSetting).toBe("stays");
    // The single feed migrated to a one-instance list; its unknown key rides along.
    expect(value.settings.feeds[0].customFlag).toBe(7);
    expect(value.settings.layout.experiment).toBe("keep-me");
    expect(value.settings.layout.sections[0].someday).toBe("maybe");
    expect(value.apps).toEqual([{ id: "broken", name: "" }]);
  });
});

describe("migrateConfig: the versioned chain (#288)", () => {
  const legacyFeed = (schemaVersion?: number) => ({
    ...(schemaVersion !== undefined && { schemaVersion }),
    settings: { feed: { enabled: true, url: "https://a.example/rss" } },
  });

  it("reads an unstamped file as version 1", () => {
    expect(configVersion({})).toBe(1);
    expect(configVersion({ schemaVersion: "2" })).toBe(1);
    expect(configVersion({ schemaVersion: 2 })).toBe(2);
  });

  // The frozen 2.x step on its own, as the chain ran before 3.0.
  const frozen = [MIGRATIONS[0]];

  it("runs the frozen legacy step for unstamped files and stamps the result", () => {
    const { value, changed } = migrateConfig(legacyFeed(), frozen);
    expect(changed).toBe(true);
    const v = value as { schemaVersion: number; settings: Record<string, unknown> };
    expect(v.schemaVersion).toBe(2);
    expect(v.settings.feed).toBeUndefined();
    expect(v.settings.feeds).toBeDefined();
  });

  it("still runs it for a v2 file: 2.1 changed the feed shape without a bump", () => {
    const { value, changed } = migrateConfig(legacyFeed(2), frozen);
    expect(changed).toBe(true);
    expect((value as { settings: Record<string, unknown> }).settings.feeds).toBeDefined();
  });

  it("leaves a current file alone, same reference, no stamp-only rewrite", () => {
    const modern = { schemaVersion: CONFIG_SCHEMA_VERSION, settings: {}, boards: [], widgets: [] };
    const result = migrateConfig(modern);
    expect(result.changed).toBe(false);
    expect(result.value).toBe(modern);
  });

  it("refuses a file from a newer release instead of downgrading it", () => {
    expect(() => migrateConfig({ schemaVersion: CONFIG_SCHEMA_VERSION + 1, settings: {} }))
      .toThrow(NewerConfigError);
  });

  it("runs every step a file is behind, in order (v1 → v2 → v3, #297)", () => {
    const fromV1 = migrateConfig(legacyFeed()).value as Record<string, unknown>;
    expect(fromV1.schemaVersion).toBe(3);
    // The 2.x step folded the single feed into the list, then v3 made it an
    // instance.
    expect(fromV1.widgets).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "feed", type: "feed", urls: ["https://a.example/rss"] })])
    );
    expect((fromV1.settings as Record<string, unknown>).feeds).toBeUndefined();
  });

  it("keys later steps on the version (a simulated v3 → v4)", () => {
    const toV4: MigrationStep = {
      to: 4,
      appliesTo: (v) => v < 4,
      run: (raw) => ({ value: { ...(raw as object), next: true }, changed: true }),
    };
    const fromV3 = migrateConfig({ schemaVersion: 3, settings: {}, widgets: [] }, [...MIGRATIONS, toV4])
      .value as Record<string, unknown>;
    expect(fromV3.schemaVersion).toBe(4);
    expect(fromV3.next).toBe(true);
    expect(fromV3.widgets).toEqual([]);
  });
});

