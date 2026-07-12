import { describe, it, expect } from "vitest";
import {
  configSchema,
  configReadSchema,
  settingsSchema,
  appInputSchema,
  bookmarkInputSchema,
  settingsInputSchema,
  weatherUpdateSchema,
  themesInputSchema,
  layoutSchema,
  bookmarkCategoryRenameSchema,
  feedUrls,
  feedUpdateSchema,
  MAX_FEED_URLS,
} from "./schema";

describe("feedUrls", () => {
  it("prefers the urls list and trims blank entries", () => {
    expect(
      feedUrls({ url: "https://old", urls: ["https://a", "  ", " https://b "] })
    ).toEqual(["https://a", "https://b"]);
  });

  it("folds the deprecated single url in when urls is empty", () => {
    expect(feedUrls({ url: "  https://old  ", urls: [] })).toEqual([
      "https://old",
    ]);
  });

  it("returns nothing when both the list and the legacy url are blank", () => {
    expect(feedUrls({ url: "  ", urls: [] })).toEqual([]);
  });
});

describe("feedUpdateSchema", () => {
  it("rejects a non-http(s) url and more than the cap", () => {
    expect(
      feedUpdateSchema.safeParse({
        enabled: true,
        urls: ["ftp://nope"],
        count: 6,
        title: "",
      }).success
    ).toBe(false);
    expect(
      feedUpdateSchema.safeParse({
        enabled: true,
        urls: Array.from({ length: MAX_FEED_URLS + 1 }, (_, i) => `https://a${i}.example`),
        count: 6,
        title: "",
      }).success
    ).toBe(false);
  });

  it("accepts blank rows (trimmed on read) up to the cap", () => {
    expect(
      feedUpdateSchema.safeParse({
        enabled: true,
        urls: ["https://a.example", ""],
        count: 6,
        title: "",
      }).success
    ).toBe(true);
  });
});

describe("themesInputSchema", () => {
  const pack = {
    name: "Mariana",
    design: "flat",
    scene: "rays",
    dark: { background: "#000000", foreground: "#ffffff", accentFrom: "#ff0000", accentTo: "#00ff00" },
    light: { background: "#ffffff", foreground: "#000000", accentFrom: "#ff0000", accentTo: "#00ff00" },
  };

  it("accepts a well-formed override array", () => {
    const parsed = themesInputSchema.parse([pack]);
    expect(parsed[0].design).toBe("flat");
    expect(parsed[0].scene).toBe("rays");
  });

  it("accepts an optional key for renaming", () => {
    const parsed = themesInputSchema.parse([{ ...pack, key: "Mariana", name: "Ocean" }]);
    expect(parsed[0].key).toBe("Mariana");
    expect(parsed[0].name).toBe("Ocean");
  });

  it("coerces a retired/unknown design or scene to the default", () => {
    // `.catch` keeps an old config (e.g. a since-removed scene) loadable instead
    // of failing the whole parse.
    const d = themesInputSchema.parse([{ ...pack, design: "nope" }]);
    expect(d[0].design).toBe("glass");
    const s = themesInputSchema.parse([{ ...pack, scene: "hologram" }]);
    expect(s[0].scene).toBe("aurora");
  });

  it("rejects a non-hex color", () => {
    const bad = { ...pack, dark: { ...pack.dark, background: "red" } };
    expect(themesInputSchema.safeParse([bad]).success).toBe(false);
  });
});

describe("configSchema defaults", () => {
  it("fills a fully empty config with defaults", () => {
    const config = configSchema.parse({});
    expect(config.apps).toEqual([]);
    expect(config.bookmarks).toEqual([]);
    expect(config.themes).toEqual([]);
    expect(config.settings.title).toBe("Home");
    expect(config.settings.theme.mode).toBe("system");
    expect(config.settings.theme.design).toBe("glass");
    expect(config.settings.theme.scene).toBe("aurora");
    expect(config.settings.theme.accentFrom).toBe("#a78bfa");
    expect(config.settings.statusChecks).toBe(false);
    expect(config.settings.statusInterval).toBe(5);
    expect(config.settings.statusDefaultRange).toBe("d1");
    expect(config.settings.statusAnnouncements).toEqual([]);
    expect(config.settings.weather.enabled).toBe(true);
    expect(config.settings.weather.units).toBe("imperial");
  });

  it("coerces per-field on a status announcement, keeping the row", () => {
    // A hand-edited row with a bad kind / non-string title stays, coerced.
    const config = configSchema.parse({
      settings: {
        statusAnnouncements: [
          { id: "x", kind: "bogus", title: 42, body: "hi" },
        ],
      },
    });
    expect(config.settings.statusAnnouncements).toEqual([
      { id: "x", kind: "info", title: "", body: "hi", startsAt: "", endsAt: "" },
    ]);
  });

  it("drops a status announcement missing its id without failing the read", () => {
    // The resilient READ variant must never let one malformed announcement row
    // fail the whole settings parse (which would 500 every page). A row with no
    // id can't coerce per-field, so it's dropped whole; the valid row survives.
    const config = configReadSchema.parse({
      settings: {
        title: "Dash",
        statusAnnouncements: [
          { title: "no id here" },
          { id: "keep", title: "Maintenance" },
        ],
      },
    });
    expect(config.settings.title).toBe("Dash");
    expect(config.settings.statusAnnouncements.map((a) => a.id)).toEqual([
      "keep",
    ]);
  });

  it("accepts an optional theme preset pointer", () => {
    const config = configSchema.parse({ settings: { theme: { preset: "Mariana" } } });
    expect(config.settings.theme.preset).toBe("Mariana");
    expect(configSchema.parse({}).settings.theme.preset).toBeUndefined();
  });

  it("coerces a retired design/scene in the default theme instead of failing", () => {
    // A pre-1.4 config whose admin default used a since-removed scene must
    // still load (the whole settings parse would otherwise 500 every page).
    const config = configSchema.parse({
      settings: { theme: { design: "nope", scene: "mesh" } },
    });
    expect(config.settings.theme.design).toBe("glass");
    expect(config.settings.theme.scene).toBe("aurora");
  });

  it("preserves provided values while defaulting the rest", () => {
    const config = configSchema.parse({ settings: { title: "Dash" } });
    expect(config.settings.title).toBe("Dash");
    expect(config.settings.timezone).toBe("UTC");
  });
});

describe("settingsSchema", () => {
  it("nests weather defaults", () => {
    const settings = settingsSchema.parse({});
    expect(settings.weather).toMatchObject({
      enabled: true,
      units: "imperial",
    });
  });
});

describe("layoutSchema topGap", () => {
  it("defaults to the stock large-screen value on configs saved before it existed", () => {
    const layout = layoutSchema.parse({
      sections: [{ id: "apps", span: 24 }],
      columns: 24,
    });
    expect(layout.topGap).toBe(64);
  });

  it("keeps a stored value and coerces an out-of-range one back to the default", () => {
    expect(layoutSchema.parse({ topGap: 8 }).topGap).toBe(8);
    expect(layoutSchema.parse({ topGap: 9999 }).topGap).toBe(64);
    expect(layoutSchema.parse({ topGap: -4 }).topGap).toBe(64);
  });
});

describe("appInputSchema", () => {
  it("requires name and a valid url, defaulting optional fields", () => {
    const parsed = appInputSchema.parse({
      name: "Plex",
      url: "https://plex.example.com",
    });
    expect(parsed).toMatchObject({
      name: "Plex",
      subtitle: "",
      icon: "",
      expectStatus: "",
      private: false,
    });
  });

  it("catches a malformed private flag to false when reading config", () => {
    const parsed = configReadSchema.parse({
      apps: [
        { id: "a", name: "X", url: "https://x.com", private: "yes" },
        { id: "b", name: "Y", url: "https://y.com", private: true },
      ],
    });
    expect(parsed.apps.map((a) => a.private)).toEqual([false, true]);
  });

  it("rejects a missing name", () => {
    expect(appInputSchema.safeParse({ url: "https://x.com" }).success).toBe(
      false
    );
  });

  it("rejects a non-url", () => {
    expect(
      appInputSchema.safeParse({ name: "X", url: "not a url" }).success
    ).toBe(false);
  });
});

describe("bookmarkInputSchema", () => {
  it("requires category, name and url", () => {
    expect(
      bookmarkInputSchema.safeParse({ name: "A", url: "https://a.com" }).success
    ).toBe(false);
    expect(
      bookmarkInputSchema.safeParse({
        category: "Shopping",
        name: "A",
        url: "https://a.com",
      }).success
    ).toBe(true);
  });
});

describe("bookmarkCategoryRenameSchema", () => {
  it("keeps `from` verbatim (stored names may carry whitespace) and trims `to`", () => {
    const parsed = bookmarkCategoryRenameSchema.parse({
      from: "  Media ",
      to: " Streaming ",
    });
    expect(parsed).toEqual({ from: "  Media ", to: "Streaming" });
  });

  it("requires `to` non-empty after trimming (trim runs BEFORE the min check)", () => {
    expect(
      bookmarkCategoryRenameSchema.safeParse({ from: "X", to: "   " }).success
    ).toBe(false);
  });

  it("rejects a no-op rename (from === trimmed to)", () => {
    expect(
      bookmarkCategoryRenameSchema.safeParse({ from: "Media", to: "Media" })
        .success
    ).toBe(false);
    // A whitespace-cleanup rename (" Media " → "Media") is a real rename.
    expect(
      bookmarkCategoryRenameSchema.safeParse({ from: " Media ", to: "Media" })
        .success
    ).toBe(true);
  });
});

describe("weatherUpdateSchema range validation", () => {
  it("accepts in-range coordinates", () => {
    expect(
      weatherUpdateSchema.safeParse({ latitude: 38.9, longitude: -77 }).success
    ).toBe(true);
  });

  it("rejects out-of-range latitude", () => {
    expect(weatherUpdateSchema.safeParse({ latitude: 200 }).success).toBe(
      false
    );
  });

  it("rejects out-of-range longitude", () => {
    expect(weatherUpdateSchema.safeParse({ longitude: -200 }).success).toBe(
      false
    );
  });
});

describe("URL scheme validation", () => {
  const valid = { name: "X", category: "C", url: "https://ok.example.com" };

  it("accepts http and https URLs", () => {
    expect(
      appInputSchema.safeParse({ ...valid, url: "https://a.com" }).success
    ).toBe(true);
    expect(
      bookmarkInputSchema.safeParse({ ...valid, url: "http://a.com" }).success
    ).toBe(true);
  });

  it("rejects javascript:, data:, and vbscript: URLs", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
    ]) {
      expect(appInputSchema.safeParse({ ...valid, url }).success).toBe(false);
      expect(bookmarkInputSchema.safeParse({ ...valid, url }).success).toBe(
        false
      );
    }
  });
});

describe("settingsInputSchema partial merge semantics", () => {
  // This guards the documented footgun: update schemas must NOT carry
  // `.default()`, so omitted fields stay absent rather than being silently
  // replaced by defaults during a partial merge.
  it("leaves omitted fields absent instead of substituting defaults", () => {
    const parsed = settingsInputSchema.parse({ title: "Only Title" });
    expect(parsed.title).toBe("Only Title");
    expect("timezone" in parsed).toBe(false);
    expect("weather" in parsed).toBe(false);
    expect("theme" in parsed).toBe(false);
    expect("statusChecks" in parsed).toBe(false);
  });

  it("accepts a valid theme and rejects an invalid one", () => {
    expect(
      settingsInputSchema.safeParse({
        theme: {
          mode: "dark",
          design: "cyber",
          scene: "abyss",
          font: "inter",
          accentFrom: "#a78bfa",
          accentTo: "#22d3ee",
        },
      }).success
    ).toBe(true);
    // Unknown design.
    expect(
      settingsInputSchema.safeParse({
        theme: {
          mode: "dark",
          design: "hologram",
          scene: "aurora",
          font: "jakarta",
          accentFrom: "#a78bfa",
          accentTo: "#22d3ee",
        },
      }).success
    ).toBe(false);
    // Unknown scene.
    expect(
      settingsInputSchema.safeParse({
        theme: {
          mode: "dark",
          design: "glass",
          scene: "hologram",
          font: "jakarta",
          accentFrom: "#a78bfa",
          accentTo: "#22d3ee",
        },
      }).success
    ).toBe(false);
    // Bad hex color.
    expect(
      settingsInputSchema.safeParse({
        theme: {
          mode: "dark",
          design: "glass",
          scene: "aurora",
          font: "jakarta",
          accentFrom: "violet",
          accentTo: "#22d3ee",
        },
      }).success
    ).toBe(false);
    // Unknown font.
    expect(
      settingsInputSchema.safeParse({
        theme: {
          mode: "dark",
          design: "glass",
          scene: "aurora",
          font: "comic-sans",
          accentFrom: "#a78bfa",
          accentTo: "#22d3ee",
        },
      }).success
    ).toBe(false);
  });
});
