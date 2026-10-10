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
  appItemSchema,
  appsBulkSchema,
  groupsSchema,
  groupsUpdateSchema,
  feedUrls,
  widgetInstancesUpdateSchema,
  newInstance,
  MAX_FEED_CARDS,
  MAX_FEED_URLS,
} from "./schema";

describe("feedUrls", () => {
  it("trims entries and drops blank rows", () => {
    expect(feedUrls({ urls: ["https://a", "  ", " https://b "] })).toEqual([
      "https://a",
      "https://b",
    ]);
  });

  it("returns nothing when the list is empty or blank-only", () => {
    expect(feedUrls({ urls: [] })).toEqual([]);
    expect(feedUrls({ urls: ["  ", ""] })).toEqual([]);
  });
});

describe("widgetInstancesUpdateSchema (#297)", () => {
  const feed = (over: Record<string, unknown> = {}) => ({
    ...newInstance("feed", "feed"),
    urls: ["https://a.example"],
    ...over,
  });
  const ok = (list: unknown) => widgetInstancesUpdateSchema.safeParse(list).success;

  it("rejects a non-http(s) feed url and more than the cap", () => {
    expect(ok([feed({ urls: ["ftp://nope"] })])).toBe(false);
    expect(
      ok([feed({ urls: Array.from({ length: MAX_FEED_URLS + 1 }, (_, i) => `https://a${i}.example`) })])
    ).toBe(false);
  });

  it("accepts blank feed rows (trimmed on read) up to the cap", () => {
    expect(ok([feed({ urls: ["https://a.example", ""] })])).toBe(true);
  });

  it("rejects duplicate ids, unsafe ids, too many feed cards, and a bad calendar url", () => {
    expect(ok([feed(), feed()])).toBe(false);
    expect(ok([feed({ id: "a b" })])).toBe(false);
    expect(ok(Array.from({ length: MAX_FEED_CARDS + 1 }, (_, i) => feed({ id: `f${i}` })))).toBe(false);
    expect(ok([{ ...newInstance("calendar", "c"), url: "javascript:x" }])).toBe(false);
    expect(ok([{ ...newInstance("calendar", "c"), url: "webcal://x.test/a.ics" }])).toBe(true);
  });

  it("requires whole instances", () => {
    expect(ok([{ id: "n", type: "notes", title: "x" }])).toBe(false);
    expect(ok([newInstance("notes", "n")])).toBe(true);
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

  it("drops a retired/unknown design or scene, for the resolver to fill in", () => {
    // `.catch` keeps an old config (e.g. a since-removed scene) loadable instead
    // of failing the whole parse; resolveThemeGallery then uses the built-in's
    // value, or the stock one for a theme of the admin's own.
    const d = themesInputSchema.parse([{ ...pack, design: "nope" }]);
    expect(d[0].design).toBeUndefined();
    const s = themesInputSchema.parse([{ ...pack, scene: "hologram" }]);
    expect(s[0].scene).toBeUndefined();
  });

  it("rejects a non-hex color", () => {
    const bad = { ...pack, dark: { ...pack.dark, background: "red" } };
    expect(themesInputSchema.safeParse([bad]).success).toBe(false);
  });

  it("takes a bare or hidden built-in reference, and a theme of the admin's own with its colors (#334)", () => {
    expect(themesInputSchema.safeParse([{ key: "Tide", builtin: "Tide" }]).success).toBe(true);
    expect(themesInputSchema.safeParse([{ key: "Tide", builtin: "Tide", hidden: true, name: "Surf" }]).success).toBe(true);
    expect(themesInputSchema.safeParse([{ key: "custom-1", ...pack, name: "Mine" }]).success).toBe(true);
    expect(themesInputSchema.safeParse([{ key: "custom-1", ...pack, name: "Mine", designLight: "paper", sceneLight: "none" }]).success).toBe(true);
  });

  it("rejects a reference to a built-in that doesn't exist, and an own theme missing its colors (#334)", () => {
    expect(themesInputSchema.safeParse([{ key: "x", builtin: "Nope" }]).success).toBe(false);
    expect(themesInputSchema.safeParse([{ key: "custom-1", name: "Mine", design: "flat" }]).success).toBe(false);
    expect(themesInputSchema.safeParse([{ key: "custom-1", name: "Mine", dark: pack.dark }]).success).toBe(false);
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
    expect(config.groups).toEqual([]);
    expect(config.settings.statusInterval).toBe(5);
    expect(config.settings.statusDefaultRange).toBe("d1");
    expect(config.settings.statusAnnouncements).toEqual([]);
    expect(config.settings.weather.enabled).toBe(true);
    expect(config.settings.weather.units).toBe("imperial");
    expect(config.settings.webhooks.digestSeconds).toBe(60);
    // The email report shows everything unless switched off (#347).
    expect(config.settings.webhooks).toMatchObject({ poster: true, facts: true, synopsis: true, subjectPrefix: "" });
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
      { id: "x", kind: "info", title: "", body: "hi", startsAt: "", endsAt: "", apps: [] },
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
  it("defaults the visitor theming policy to everything, and takes the others (#335)", () => {
    expect(settingsSchema.parse({}).visitorTheming).toBe("all");
    expect(settingsSchema.parse({ visitorTheming: "packs" }).visitorTheming).toBe("packs");
    expect(settingsInputSchema.safeParse({ visitorTheming: "none" }).success).toBe(true);
    expect(settingsInputSchema.safeParse({ visitorTheming: "some" }).success).toBe(false);
  });

  it("nests weather defaults", () => {
    const settings = settingsSchema.parse({});
    expect(settings.weather).toMatchObject({
      enabled: true,
      units: "imperial",
    });
  });

});

describe("settingsInputSchema", () => {
  it("leaves an omitted field absent, so the partial merge keeps it", () => {
    expect(settingsInputSchema.parse({ statusChecks: true })).toEqual({ statusChecks: true });
    expect(settingsInputSchema.parse({}).statusChecks).toBeUndefined();
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
  it("requires a group name, a name and a URL", () => {
    expect(bookmarkInputSchema.safeParse({ name: "A", url: "https://a.com" }).success).toBe(false);
    expect(bookmarkInputSchema.safeParse({ groupName: "  ", name: "A", url: "https://a.com" }).success).toBe(false);
    expect(
      bookmarkInputSchema.parse({ groupName: " Shopping ", name: "A", url: "https://a.com" }).groupName
    ).toBe("Shopping");
  });
});

describe("app groups and tags (#299)", () => {
  it("defaults to no group and no tags, and cleans stored tags", () => {
    const app = appItemSchema.parse({ id: "a", name: "A", url: "https://a.com" });
    expect(app.group).toBe("");
    expect(app.tags).toEqual([]);
    expect(appItemSchema.parse({ id: "a", name: "A", url: "https://a.com", tags: [" x ", "X", "", 3, "y"] }).tags).toEqual([
      "x",
      "y",
    ]);
  });

  it("cleans tag input and caps it", () => {
    expect(appInputSchema.parse({ name: "A", url: "https://a.com", tags: ["a", " a ", "b"] }).tags).toEqual(["a", "b"]);
    expect(appInputSchema.safeParse({ name: "A", url: "https://a.com", tags: Array(13).fill("t") }).success).toBe(false);
  });

  it("validates a bulk change", () => {
    expect(appsBulkSchema.safeParse({ ids: ["a"] }).success).toBe(false);
    expect(appsBulkSchema.safeParse({ ids: [], groupName: "X" }).success).toBe(false);
    expect(appsBulkSchema.safeParse({ ids: ["a"], groupName: "" }).success).toBe(true);
    expect(appsBulkSchema.safeParse({ ids: ["a"], addTags: ["t"] }).success).toBe(true);
  });

  it("keeps groups lenient on read and strict on input", () => {
    expect(groupsSchema.parse([{ id: "a", name: "A" }, { id: "a", name: "Again" }, { id: "b c", name: "B" }, { id: "d", name: " " }])).toEqual([
      { id: "a", name: "A" },
    ]);
    expect(groupsUpdateSchema.safeParse([{ id: "a", name: "A" }, { id: "a", name: "B" }]).success).toBe(false);
    expect(groupsUpdateSchema.safeParse([{ id: "a", name: "A" }, { id: "b", name: "a" }]).success).toBe(true);
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
  const valid = { name: "X", groupName: "C", url: "https://ok.example.com" };

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

  it("takes the webhook burst window within its bounds, leaving the services alone (#346)", () => {
    expect(settingsInputSchema.parse({ webhooks: { digestSeconds: 0 } })).toEqual({
      webhooks: { digestSeconds: 0 },
    });
    expect(settingsInputSchema.safeParse({ webhooks: { digestSeconds: 300 } }).success).toBe(true);
    expect(settingsInputSchema.safeParse({ webhooks: { digestSeconds: 301 } }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ webhooks: { digestSeconds: 1.5 } }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ webhooks: { digestSeconds: -1 } }).success).toBe(false);
  });

  it("takes the email report options one at a time, the prefix capped (#347)", () => {
    expect(settingsInputSchema.parse({ webhooks: { synopsis: false } })).toEqual({
      webhooks: { synopsis: false },
    });
    expect(settingsInputSchema.safeParse({ webhooks: { subjectPrefix: "[Home]" } }).success).toBe(true);
    expect(settingsInputSchema.safeParse({ webhooks: { subjectPrefix: "x".repeat(41) } }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ webhooks: { poster: "no" } }).success).toBe(false);
  });

  it("takes the page-level layout values partially, with no rows (#298)", () => {
    const parsed = settingsInputSchema.parse({ layout: { gap: 24 } });
    expect(parsed.layout).toEqual({ gap: 24 });
    expect(settingsInputSchema.safeParse({ layout: { gap: 999 } }).success).toBe(false);
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

describe("countdown date resilience", () => {
  it("folds a YAML-parsed Date back to the calendar string instead of failing", () => {
    // A hand-edited config's unquoted `date: 2026-09-01` reaches the schema as
    // a JS Date (YAML's timestamp type); one such row must not 500 every page.
    const config = configSchema.parse({
      widgets: [
        {
          id: "countdown",
          type: "countdown",
          items: [
            { label: "Renewal", date: new Date("2026-09-01") },
            { label: "Typed", date: "2026-10-15" },
            { label: "Junk", date: 42 },
          ],
        },
      ],
    });
    const countdown = config.widgets[0];
    expect(countdown.type === "countdown" && countdown.items).toEqual([
      { label: "Renewal", date: "2026-09-01" },
      { label: "Typed", date: "2026-10-15" },
      { label: "Junk", date: "" },
    ]);
  });
});
