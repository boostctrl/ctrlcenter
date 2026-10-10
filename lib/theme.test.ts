import { describe, it, expect } from "vitest";
import {
  resolveThemePacks,
  sanitizeTune,
  isDefaultTune,
  sanitizeSceneFx,
  isDefaultSceneFx,
  colorSetsEqual,
  tunesEqual,
  sceneFxEqual,
  sanitizeSemantic,
  semanticEqual,
  sanitizeWallpaper,
  wallpaperEqual,
  isWallpaperSrc,
  DEFAULT_SCENE_FX,
  DEFAULT_TUNE,
  THEME_PACKS,
  DESIGNS,
  SCENES,
  BASE_THEMES,
  resolveThemeGallery,
  uniquePackName,
  packFields,
  packDesign,
  packScene,
  type ThemeEntry,
} from "./theme";

describe("catalog sizes", () => {
  it("ships 18 designs, 25 scenes plus None, 21 palettes, 12 themes", () => {
    expect(DESIGNS).toHaveLength(18);
    expect(SCENES).toHaveLength(26);
    expect(SCENES[0].id).toBe("none");
    expect(BASE_THEMES).toHaveLength(21);
    expect(THEME_PACKS).toHaveLength(12);
  });

  it("no pack references a retired scene id", () => {
    const ids = SCENES.map((s) => s.id) as string[];
    for (const p of THEME_PACKS) expect(ids).toContain(p.scene);
    for (const retired of ["glow", "vortex", "mesh"]) {
      expect(ids).not.toContain(retired);
    }
  });
});

describe("resolveThemePacks", () => {
  const override: ThemeEntry = {
    key: "Mariana",
    name: "Mariana",
    design: "flat",
    scene: "rays",
    dark: { background: "#000000", foreground: "#ffffff", accentFrom: "#ff0000", accentTo: "#00ff00" },
    light: { background: "#ffffff", foreground: "#000000", accentFrom: "#ff0000", accentTo: "#00ff00" },
  };
  // A resolved pack names its built-in; the shipped list doesn't.
  const shipped = (i: number) => ({ ...THEME_PACKS[i], builtin: THEME_PACKS[i].name });

  it("returns the built-ins unchanged with no overrides", () => {
    expect(resolveThemePacks([])).toBe(THEME_PACKS);
    expect(resolveThemePacks(undefined)).toBe(THEME_PACKS);
  });

  it("replaces a built-in by key, preserving order", () => {
    const resolved = resolveThemePacks([override]);
    expect(resolved).toHaveLength(THEME_PACKS.length);
    const idx = THEME_PACKS.findIndex((p) => p.name === "Mariana");
    expect(resolved[idx]).toEqual({ ...override, key: undefined, builtin: "Mariana" });
    expect(resolved[idx].design).toBe("flat");
    // Other packs untouched.
    expect(resolved[0]).toEqual(shipped(0));
  });

  it("drops an entry naming a built-in that doesn't exist, and matches a key-less one by name (#305)", () => {
    const stale: ThemeEntry = { ...override, key: "Nope", name: "Nope", builtin: "Nope" };
    expect(resolveThemePacks([stale])).toEqual(THEME_PACKS.map((_, i) => shipped(i)));
    const keyless: ThemeEntry = { ...override, key: undefined };
    const idx = THEME_PACKS.findIndex((p) => p.name === "Mariana");
    expect(resolveThemePacks([keyless])[idx].design).toBe("flat");
  });

  it("renames the matched built-in via key, keeping its slot/order", () => {
    const renamed: ThemeEntry = { ...override, key: "Mariana", name: "Ocean" };
    const resolved = resolveThemePacks([renamed]);
    const idx = THEME_PACKS.findIndex((p) => p.name === "Mariana");
    expect(resolved).toHaveLength(THEME_PACKS.length);
    expect(resolved[idx].name).toBe("Ocean");
    expect(resolved[idx].design).toBe("flat");
    expect(resolved[0]).toEqual(shipped(0)); // others untouched
  });
});

describe("the theme gallery (#334)", () => {
  const colors = {
    dark: { background: "#000000", foreground: "#ffffff", accentFrom: "#ff0000", accentTo: "#00ff00" },
    light: { background: "#ffffff", foreground: "#000000", accentFrom: "#ff0000", accentTo: "#00ff00" },
  };
  const names = (entries: ThemeEntry[] | undefined) => resolveThemeGallery(entries).map((r) => r.pack.name);

  it("lists the built-ins as shipped with nothing stored", () => {
    const g = resolveThemeGallery([]);
    expect(g.map((r) => r.key)).toEqual(THEME_PACKS.map((p) => p.name));
    expect(g.every((r) => !r.hidden && !r.edited && r.builtin === r.key && r.entry === undefined)).toBe(true);
  });

  it("follows the stored order once an entry names its built-in, then the rest as shipped", () => {
    const g = names([
      { key: "Tide", builtin: "Tide" },
      { key: "Default", builtin: "Default" },
    ]);
    expect(g.slice(0, 2)).toEqual(["Tide", "Default"]);
    expect(g.slice(2)).toEqual(THEME_PACKS.map((p) => p.name).filter((n) => n !== "Tide" && n !== "Default"));
    expect(g).toHaveLength(THEME_PACKS.length);
  });

  it("keeps a pack of the admin's own, in place, and drops one missing its colors", () => {
    const mine: ThemeEntry = { key: "custom-ab12cd34", name: "Mine", design: "paper", ...colors };
    const g = resolveThemeGallery([mine, { key: "Default", builtin: "Default" }]);
    expect(g[0]).toMatchObject({ key: "custom-ab12cd34", hidden: false, edited: true });
    expect(g[0].builtin).toBeUndefined();
    expect(g[0].pack).toEqual({ name: "Mine", design: "paper", scene: "aurora", ...colors });
    expect(g[1].key).toBe("Default");
    expect(names([{ key: "custom-x", name: "Half", dark: colors.dark }])).toEqual(THEME_PACKS.map((p) => p.name));
  });

  it("hides from visitors but not from the admin, and never a built-in twice", () => {
    const entries: ThemeEntry[] = [
      { key: "Outrun", builtin: "Outrun", hidden: true },
      { key: "Outrun", builtin: "Outrun" },
    ];
    expect(resolveThemePacks(entries).map((p) => p.name)).not.toContain("Outrun");
    expect(resolveThemePacks(entries)).toHaveLength(THEME_PACKS.length - 1);
    const g = resolveThemeGallery(entries);
    expect(g.filter((r) => r.key === "Outrun")).toHaveLength(1);
    expect(g[0]).toMatchObject({ key: "Outrun", hidden: true, edited: false });
  });

  it("shows a bare or renamed built-in as shipped, so later tweaks to it still reach the site", () => {
    const tide = THEME_PACKS.find((p) => p.name === "Tide")!;
    const bare = resolveThemeGallery([{ key: "Tide", builtin: "Tide" }])[0];
    expect(bare.pack).toEqual({ ...tide, builtin: "Tide" });
    expect(bare.edited).toBe(false);
    const renamed = resolveThemeGallery([{ key: "Tide", builtin: "Tide", name: "Surf" }])[0];
    expect(renamed.pack).toEqual({ ...tide, name: "Surf", builtin: "Tide" });
    expect(renamed.edited).toBe(false);
  });

  it("takes an edited built-in's own optional parts, falling back only for the required ones", () => {
    const tune = { ...DEFAULT_TUNE, radius: 50 };
    const g = resolveThemeGallery([{ key: "Tide", builtin: "Tide", tune, scene: "rain" }])[0];
    expect(g.edited).toBe(true);
    expect(g.pack.tune).toEqual(tune);
    expect(g.pack.scene).toBe("rain");
    expect(g.pack.design).toBe(THEME_PACKS.find((p) => p.name === "Tide")!.design);
    // An edited copy that clears its wallpaper keeps it cleared.
    const cleared = resolveThemeGallery([{ key: "Tide", builtin: "Tide", ...packFields(THEME_PACKS[0]), wallpaper: undefined }])[0];
    expect(cleared.pack.wallpaper).toBeUndefined();
  });

  it("gives a pack a light design and scene of its own, else the dark ones", () => {
    const pack = { ...THEME_PACKS[0], designLight: "paper" as const };
    expect(packDesign(pack, true)).toBe(THEME_PACKS[0].design);
    expect(packDesign(pack, false)).toBe("paper");
    expect(packScene(pack, false)).toBe(THEME_PACKS[0].scene);
  });

  it("makes a name unique among the packs", () => {
    expect(uniquePackName("Ocean", ["Tide"])).toBe("Ocean");
    expect(uniquePackName("Ocean", ["ocean"])).toBe("Ocean 2");
    expect(uniquePackName("Ocean", ["Ocean", "Ocean 2"])).toBe("Ocean 3");
    expect(uniquePackName("   ", [])).toBe("Theme");
  });
});

describe("sanitizeTune (#326)", () => {
  it("clamps every knob to its range and rounds to whole percents", () => {
    expect(sanitizeTune({ radius: 150.4, border: 999, blur: -5, shadow: 50, fill: 120, glow: 0 })).toEqual({
      radius: 150,
      border: 300,
      blur: 0,
      shadow: 50,
      fill: 120,
      glow: 0,
    });
  });

  it("fills a partial tune with 100 and rejects junk", () => {
    expect(sanitizeTune({ radius: 50 })).toEqual({ ...DEFAULT_TUNE, radius: 50 });
    expect(sanitizeTune({ radius: "50" })).toBeNull();
    expect(sanitizeTune(null)).toBeNull();
    expect(sanitizeTune("x")).toBeNull();
    expect(sanitizeTune({ nope: 1 })).toBeNull();
  });

  it("knows the untouched tune", () => {
    expect(isDefaultTune(null)).toBe(true);
    expect(isDefaultTune(DEFAULT_TUNE)).toBe(true);
    expect(isDefaultTune({ ...DEFAULT_TUNE, glow: 80 })).toBe(false);
  });
});

describe("sanitizeSceneFx (#327)", () => {
  it("clamps the intensity and validates the motion level", () => {
    expect(sanitizeSceneFx({ intensity: 140, motion: "calm" })).toEqual({ intensity: 100, motion: "calm" });
    expect(sanitizeSceneFx({ intensity: 33.4 })).toEqual({ intensity: 33, motion: "normal" });
    expect(sanitizeSceneFx({ motion: "off" })).toEqual({ intensity: 100, motion: "off" });
    expect(sanitizeSceneFx({ motion: "fast" })).toBeNull();
    expect(sanitizeSceneFx(null)).toBeNull();
  });

  it("knows the as-designed effects", () => {
    expect(isDefaultSceneFx(null)).toBe(true);
    expect(isDefaultSceneFx({ intensity: 100, motion: "normal" })).toBe(true);
    expect(isDefaultSceneFx({ intensity: 100, motion: "calm" })).toBe(false);
  });
});

describe("look equality (#328)", () => {
  it("compares colors case-insensitively", () => {
    const a = { background: "#06070D", foreground: "#f4f4f6", accentFrom: "#A78BFA", accentTo: "#22d3ee" };
    expect(colorSetsEqual(a, { ...a, background: "#06070d", accentFrom: "#a78bfa" })).toBe(true);
    expect(colorSetsEqual(a, { ...a, accentTo: "#22d3ef" })).toBe(false);
  });

  it("treats an absent tune or effects as the default", () => {
    expect(tunesEqual(null, DEFAULT_TUNE)).toBe(true);
    expect(tunesEqual(undefined, { ...DEFAULT_TUNE, glow: 50 })).toBe(false);
    expect(tunesEqual({ ...DEFAULT_TUNE, glow: 50 }, { ...DEFAULT_TUNE, glow: 50 })).toBe(true);
    expect(sceneFxEqual(null, DEFAULT_SCENE_FX)).toBe(true);
    expect(sceneFxEqual({ intensity: 50, motion: "calm" }, { intensity: 50, motion: "off" })).toBe(false);
  });
});

describe("semantic colors (#331)", () => {
  const set = { up: "#00ff00", down: "#ff0000", warning: "#ffaa00", info: "#00aaff" };

  it("needs all four hex colors", () => {
    expect(sanitizeSemantic(set)).toEqual(set);
    expect(sanitizeSemantic({ ...set, info: "blue" })).toBeNull();
    expect(sanitizeSemantic({ up: "#00ff00" })).toBeNull();
    expect(sanitizeSemantic(null)).toBeNull();
  });

  it("compares case-insensitively and treats absent as absent", () => {
    expect(semanticEqual(set, { ...set, up: "#00FF00" })).toBe(true);
    expect(semanticEqual(set, null)).toBe(false);
    expect(semanticEqual(undefined, null)).toBe(true);
  });
});

describe("wallpaper (#333)", () => {
  it("accepts http(s) URLs and same-origin paths, nothing that could break a url()", () => {
    expect(isWallpaperSrc("https://example.com/a.jpg")).toBe(true);
    expect(isWallpaperSrc("/api/icons/wallpaper-sea-1a2b3c4d.jpg")).toBe(true);
    expect(isWallpaperSrc("//evil.example/x.png")).toBe(false);
    expect(isWallpaperSrc("javascript:alert(1)")).toBe(false);
    expect(isWallpaperSrc("https://example.com/a\") b.jpg")).toBe(false);
    expect(isWallpaperSrc("https://example.com/a'b.jpg")).toBe(false);
    expect(isWallpaperSrc("https://example.com/a b.jpg")).toBe(false);
    expect(isWallpaperSrc("")).toBe(false);
    expect(isWallpaperSrc("https://example.com/" + "a".repeat(2048))).toBe(false);
  });

  it("sanitizes blur, dim and fit, with defaults for what's missing", () => {
    expect(sanitizeWallpaper({ src: "https://x.y/a.jpg" })).toEqual({ src: "https://x.y/a.jpg", blur: 0, dim: 0, fit: "cover" });
    expect(sanitizeWallpaper({ src: "https://x.y/a.jpg", blur: 99, dim: -5, fit: "tile" })).toEqual({
      src: "https://x.y/a.jpg",
      blur: 40,
      dim: 0,
      fit: "tile",
    });
    expect(sanitizeWallpaper({ src: "https://x.y/a.jpg", blur: 12.4, dim: 30.6, fit: "stretch" })).toEqual({
      src: "https://x.y/a.jpg",
      blur: 12,
      dim: 31,
      fit: "cover",
    });
    expect(sanitizeWallpaper({ src: "" })).toBeNull();
    expect(sanitizeWallpaper({ src: "ftp://x/a.jpg" })).toBeNull();
    expect(sanitizeWallpaper("https://x.y/a.jpg")).toBeNull();
    expect(sanitizeWallpaper(null)).toBeNull();
  });

  it("compares field by field and treats absent as absent", () => {
    const a = { src: "https://x.y/a.jpg", blur: 4, dim: 20, fit: "cover" as const };
    expect(wallpaperEqual(a, { ...a })).toBe(true);
    expect(wallpaperEqual(a, { ...a, dim: 25 })).toBe(false);
    expect(wallpaperEqual(a, null)).toBe(false);
    expect(wallpaperEqual(undefined, null)).toBe(true);
  });
});
