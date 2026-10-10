import { describe, it, expect } from "vitest";
import {
  sanitizePrefs,
  sanitizeColors,
  sanitizeModeColors,
  sanitizeCustomTheme,
  siteThemeFromCustomTheme,
  packFromCustomTheme,
  encodeThemeCode,
  decodeThemeCode,
  type CustomTheme,
} from "./prefs";
import { themeInputSchema, themeEntrySchema } from "./schema";

const valid = {
  background: "#06070d",
  foreground: "#ffffff",
  accentFrom: "#a78bfa",
  accentTo: "#22d3ee",
};

describe("sanitizeColors", () => {
  it("accepts four valid 6-digit hex colors", () => {
    expect(sanitizeColors(valid)).toEqual(valid);
  });

  it("rejects non-objects and missing fields", () => {
    expect(sanitizeColors(null)).toBeNull();
    expect(sanitizeColors({ background: "#fff" })).toBeNull();
  });

  it("rejects non-hex or short-hex values", () => {
    expect(sanitizeColors({ ...valid, background: "red" })).toBeNull();
    expect(sanitizeColors({ ...valid, accentTo: "#fff" })).toBeNull();
    expect(
      sanitizeColors({ ...valid, foreground: "#12345g" })
    ).toBeNull();
  });
});

describe("sanitizeModeColors", () => {
  const light = { ...valid, background: "#eceef3", foreground: "#181b24" };

  it("accepts a {dark, light} pair", () => {
    expect(sanitizeModeColors({ dark: valid, light })).toEqual({
      dark: valid,
      light,
    });
  });

  it("migrates an old single color set to both modes", () => {
    // Back-compat: a value saved before looks were mode-aware was one flat set.
    expect(sanitizeModeColors(valid)).toEqual({ dark: valid, light: valid });
  });

  it("rejects junk and partial pairs", () => {
    expect(sanitizeModeColors(null)).toBeNull();
    expect(sanitizeModeColors({ dark: valid })).toBeNull();
    expect(sanitizeModeColors({ dark: valid, light: { background: "#fff" } })).toBeNull();
  });
});

describe("sanitizePrefs", () => {
  it("returns empty for non-objects", () => {
    expect(sanitizePrefs(null)).toEqual({});
    expect(sanitizePrefs("nope")).toEqual({});
    expect(sanitizePrefs(42)).toEqual({});
  });

  it("keeps valid timezone, units, and dismissedAuto", () => {
    expect(
      sanitizePrefs({
        timezone: "America/Chicago",
        units: "metric",
        dismissedAuto: true,
      })
    ).toEqual({
      timezone: "America/Chicago",
      units: "metric",
      dismissedAuto: true,
    });
  });

  it("drops invalid units and non-true dismissedAuto", () => {
    const out = sanitizePrefs({ units: "kelvin", dismissedAuto: "yes" });
    expect(out.units).toBeUndefined();
    expect(out.dismissedAuto).toBeUndefined();
  });

  it("drops an invalid time zone so the clock can't crash on it", () => {
    expect(sanitizePrefs({ timezone: "America/Chicagoo" }).timezone).toBeUndefined();
    expect(sanitizePrefs({ timezone: "" }).timezone).toBeUndefined();
  });

  it("accepts a well-formed in-range location with a clamped label", () => {
    const out = sanitizePrefs({
      location: {
        latitude: 41.88,
        longitude: -87.63,
        label: "Chicago",
        source: "ip",
      },
    });
    expect(out.location).toMatchObject({
      latitude: 41.88,
      longitude: -87.63,
      label: "Chicago",
      source: "ip",
    });
  });

  it("rejects out-of-range or non-numeric coordinates", () => {
    expect(sanitizePrefs({ location: { latitude: 200, longitude: 0 } }).location).toBeUndefined();
    expect(
      sanitizePrefs({ location: { latitude: "x", longitude: 0 } }).location
    ).toBeUndefined();
  });

  it("defaults an unknown location source to manual", () => {
    const out = sanitizePrefs({
      location: { latitude: 1, longitude: 2, source: "satellite" },
    });
    expect(out.location?.source).toBe("manual");
  });
});

describe("siteThemeFromCustomTheme", () => {
  const saved: CustomTheme = {
    id: "t1",
    name: "Lava",
    dark: {
      background: "#1a0b0b",
      foreground: "#ffe8d6",
      accentFrom: "#ff5722",
      accentTo: "#ffc107",
    },
    light: {
      background: "#fff3ec",
      foreground: "#3b1d12",
      accentFrom: "#c2185b",
      accentTo: "#7b1fa2",
    },
    design: "bold",
    scene: "rays",
    font: "jakarta",
    designLight: "paper",
    sceneLight: "dots",
    fontLight: "jakarta",
  };

  it("produces a valid whole-theme input the settings API accepts", () => {
    const parsed = themeInputSchema.parse(siteThemeFromCustomTheme(saved, "system"));
    expect(parsed.accentFrom).toBe("#ff5722");
    expect(parsed.accentFromLight).toBe("#c2185b");
    expect(parsed.backgroundLight).toBe("#fff3ec");
    expect(parsed.designLight).toBe("paper");
    expect(parsed.mode).toBe("system");
  });

  it("covers every site-theme field except the pack presets", () => {
    // The settings API replaces the theme wholesale, so any themeInputSchema
    // field this mapping omits silently resets for every visitor. If this
    // fails after adding a theme field, extend siteThemeFromCustomTheme (or
    // add the field to the deliberate omissions here).
    const omittedOnPurpose = ["preset", "presetLight"];
    const mapped = Object.keys(siteThemeFromCustomTheme(saved, "dark")).sort();
    const schemaKeys = Object.keys(themeInputSchema.shape)
      .filter((k) => !omittedOnPurpose.includes(k))
      .sort();
    expect(mapped).toEqual(schemaKeys);
  });
});

describe("sanitizeCustomTheme tune (#326)", () => {
  const base = {
    name: "Tuned",
    dark: valid,
    light: { ...valid, background: "#eceef3", foreground: "#181b24" },
  };

  it("keeps a valid tune per mode and drops an invalid one", () => {
    const t = sanitizeCustomTheme({ ...base, tune: { radius: 50 }, tuneLight: "x" });
    expect(t?.tune).toEqual({ radius: 50, border: 100, blur: 100, shadow: 100, fill: 100, glow: 100 });
    expect(t?.tuneLight).toBeUndefined();
  });

  it("promotes the tune to the site theme", () => {
    const t = sanitizeCustomTheme({ ...base, tune: { glow: 0 }, tuneLight: { blur: 50 } })!;
    const site = siteThemeFromCustomTheme(t, "system");
    expect(site.tune?.glow).toBe(0);
    expect(site.tuneLight?.blur).toBe(50);
    expect(themeInputSchema.parse(site).tuneLight?.blur).toBe(50);
  });
});

describe("sanitizeCustomTheme scene effects (#327)", () => {
  const base = {
    name: "Calm",
    dark: valid,
    light: { ...valid, background: "#eceef3", foreground: "#181b24" },
  };

  it("keeps valid effects per mode and promotes them to the site theme", () => {
    const t = sanitizeCustomTheme({ ...base, sceneFx: { motion: "calm" }, sceneFxLight: { intensity: 30 } })!;
    expect(t.sceneFx).toEqual({ intensity: 100, motion: "calm" });
    expect(t.sceneFxLight).toEqual({ intensity: 30, motion: "normal" });
    const site = themeInputSchema.parse(siteThemeFromCustomTheme(t, "dark"));
    expect(site.sceneMotion).toBe("calm");
    expect(site.sceneIntensityLight).toBe(30);
    expect(sanitizeCustomTheme({ ...base, sceneFx: { motion: "nope" } })?.sceneFx).toBeUndefined();
  });
});

describe("theme codes (#329)", () => {
  const theme = sanitizeCustomTheme({
    name: "Rosé nuit",
    dark: valid,
    light: { ...valid, background: "#eceef3", foreground: "#181b24" },
    design: "cyber",
    scene: "grid",
    font: "inter",
    tune: { glow: 50 },
    sceneFx: { motion: "calm" },
  })!;

  it("round-trips a theme through a code, minting a new id", () => {
    const code = encodeThemeCode(theme);
    expect(code.startsWith("ctc1.")).toBe(true);
    expect(code).not.toMatch(/[+/=]/);
    const back = decodeThemeCode(code)!;
    expect(back.id).not.toBe(theme.id);
    const { id: _a, ...a } = theme;
    const { id: _b, ...b } = back;
    void _a;
    void _b;
    expect(b).toEqual(a);
  });

  it("accepts a link and surrounding whitespace, and rejects anything else", () => {
    const code = encodeThemeCode(theme);
    expect(decodeThemeCode(`  https://home.lan/settings#theme=${code}\n`)?.name).toBe("Rosé nuit");
    expect(decodeThemeCode("ctc1.not base64!!")).toBeNull();
    expect(decodeThemeCode("hello")).toBeNull();
    expect(decodeThemeCode("ctc1." + Buffer.from("{\"name\":1}").toString("base64url"))).toBeNull();
  });
});

describe("sanitizeCustomTheme typography (#330)", () => {
  it("keeps a heading face and a non-default density, and promotes them", () => {
    const t = sanitizeCustomTheme({
      name: "Serif",
      dark: valid,
      light: { ...valid, background: "#eceef3", foreground: "#181b24" },
      headingFont: "playfair",
      headingFontLight: "nope",
      density: "compact",
      densityLight: "comfortable",
    })!;
    expect(t.headingFont).toBe("playfair");
    expect(t.headingFontLight).toBeUndefined();
    expect(t.density).toBe("compact");
    expect(t.densityLight).toBeUndefined();
    const site = themeInputSchema.parse(siteThemeFromCustomTheme(t, "dark"));
    expect(site.headingFont).toBe("playfair");
    expect(site.density).toBe("compact");
  });
});

describe("sanitizeCustomTheme status colors (#331)", () => {
  it("keeps a full set per mode and promotes it", () => {
    const set = { up: "#00ff00", down: "#ff0000", warning: "#ffaa00", info: "#00aaff" };
    const t = sanitizeCustomTheme({
      name: "Signals",
      dark: valid,
      light: { ...valid, background: "#eceef3", foreground: "#181b24" },
      status: set,
      statusLight: { up: "#00ff00" },
    })!;
    expect(t.status).toEqual(set);
    expect(t.statusLight).toBeUndefined();
    expect(themeInputSchema.parse(siteThemeFromCustomTheme(t, "dark")).status?.down).toBe("#ff0000");
  });
});

describe("sanitizeCustomTheme wallpaper (#333)", () => {
  it("keeps a valid wallpaper per mode, drops a bad one, and promotes it", () => {
    const wp = { src: "https://example.com/sea.jpg", blur: 8, dim: 40, fit: "tile" };
    const t = sanitizeCustomTheme({
      name: "Shore",
      dark: valid,
      light: { ...valid, background: "#eceef3", foreground: "#181b24" },
      wallpaper: wp,
      wallpaperLight: { src: "javascript:alert(1)" },
    })!;
    expect(t.wallpaper).toEqual(wp);
    expect(t.wallpaperLight).toBeUndefined();
    const site = themeInputSchema.parse(siteThemeFromCustomTheme(t, "dark"));
    expect(site.wallpaper?.src).toBe("https://example.com/sea.jpg");
    expect(site.wallpaperLight).toBeUndefined();
    // Survives a code round trip.
    expect(decodeThemeCode(encodeThemeCode(t))?.wallpaper).toEqual(wp);
  });
});

describe("packFromCustomTheme (#334)", () => {
  it("maps a saved theme to a gallery pack the schema accepts, with light's own design and scene", () => {
    const t = sanitizeCustomTheme({
      name: "Shore",
      design: "paper",
      scene: "rain",
      designLight: "flat",
      sceneLight: "none",
      font: "inter",
      headingFont: "lora",
      dark: valid,
      light: { ...valid, background: "#eceef3", foreground: "#181b24" },
      tune: { radius: 50, border: 100, blur: 100, shadow: 100, fill: 100, glow: 100 },
      status: { up: "#00ff00", down: "#ff0000", warning: "#ffaa00", info: "#00aaff" },
      wallpaper: { src: "https://example.com/sea.jpg", blur: 8, dim: 40, fit: "tile" },
    })!;
    const pack = packFromCustomTheme(t);
    expect(pack).toMatchObject({
      name: "Shore",
      design: "paper",
      scene: "rain",
      designLight: "flat",
      sceneLight: "none",
      font: "inter",
      headingFont: "lora",
      wallpaper: { src: "https://example.com/sea.jpg" },
    });
    expect(pack.tune?.radius).toBe(50);
    expect(pack.status?.down).toBe("#ff0000");
    expect(themeEntrySchema.safeParse({ key: "custom-1", ...pack }).success).toBe(true);
    // The same design and scene in both modes, and the default font, are left out.
    const plain = packFromCustomTheme(sanitizeCustomTheme({ name: "Plain", dark: valid, light: valid })!);
    expect(plain.designLight).toBeUndefined();
    expect(plain.sceneLight).toBeUndefined();
    expect(plain.font).toBeUndefined();
  });
});
