import { describe, it, expect } from "vitest";
import {
  configSchema,
  settingsSchema,
  appInputSchema,
  bookmarkInputSchema,
  settingsInputSchema,
  weatherUpdateSchema,
  themesInputSchema,
} from "./schema";

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
    // `.catch` keeps an old config (e.g. a "mesh" scene) loadable instead of
    // failing the whole parse.
    const d = themesInputSchema.parse([{ ...pack, design: "nope" }]);
    expect(d[0].design).toBe("glass");
    const s = themesInputSchema.parse([{ ...pack, scene: "mesh" }]);
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
    expect(config.settings.weather.enabled).toBe(true);
    expect(config.settings.weather.units).toBe("imperial");
  });

  it("accepts an optional theme preset pointer", () => {
    const config = configSchema.parse({ settings: { theme: { preset: "Mariana" } } });
    expect(config.settings.theme.preset).toBe("Mariana");
    expect(configSchema.parse({}).settings.theme.preset).toBeUndefined();
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
    });
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
          accentFrom: "violet",
          accentTo: "#22d3ee",
        },
      }).success
    ).toBe(false);
  });
});
