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
  DEFAULT_SCENE_FX,
  DEFAULT_TUNE,
  THEME_PACKS,
  DESIGNS,
  SCENES,
  BASE_THEMES,
  type ThemePackOverride,
} from "./theme";

describe("catalog sizes", () => {
  it("ships 18 designs, 18 scenes plus None, 21 palettes, 12 themes", () => {
    expect(DESIGNS).toHaveLength(18);
    expect(SCENES).toHaveLength(19);
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
  const override: ThemePackOverride = {
    key: "Mariana",
    name: "Mariana",
    design: "flat",
    scene: "rays",
    dark: { background: "#000000", foreground: "#ffffff", accentFrom: "#ff0000", accentTo: "#00ff00" },
    light: { background: "#ffffff", foreground: "#000000", accentFrom: "#ff0000", accentTo: "#00ff00" },
  };

  it("returns the built-ins unchanged with no overrides", () => {
    expect(resolveThemePacks([])).toBe(THEME_PACKS);
    expect(resolveThemePacks(undefined)).toBe(THEME_PACKS);
  });

  it("replaces a built-in by key, preserving order", () => {
    const resolved = resolveThemePacks([override]);
    expect(resolved).toHaveLength(THEME_PACKS.length);
    const idx = THEME_PACKS.findIndex((p) => p.name === "Mariana");
    expect(resolved[idx]).toEqual(override);
    expect(resolved[idx].design).toBe("flat");
    // Other packs untouched.
    expect(resolved[0]).toEqual(THEME_PACKS[0]);
  });

  it("ignores overrides whose key matches no built-in, and key-less ones (#305)", () => {
    const stale: ThemePackOverride = { ...override, key: "Nope", name: "Nope" };
    expect(resolveThemePacks([stale])).toEqual(THEME_PACKS);
    const keyless: ThemePackOverride = { ...override, key: undefined };
    expect(resolveThemePacks([keyless])).toEqual(THEME_PACKS);
  });

  it("renames the matched built-in via key, keeping its slot/order", () => {
    const renamed: ThemePackOverride = { ...override, key: "Mariana", name: "Ocean" };
    const resolved = resolveThemePacks([renamed]);
    const idx = THEME_PACKS.findIndex((p) => p.name === "Mariana");
    expect(resolved).toHaveLength(THEME_PACKS.length);
    expect(resolved[idx].name).toBe("Ocean");
    expect(resolved[idx].design).toBe("flat");
    expect(resolved[0]).toEqual(THEME_PACKS[0]); // others untouched
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
