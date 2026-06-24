import { describe, it, expect } from "vitest";
import {
  resolveThemePacks,
  THEME_PACKS,
  DESIGNS,
  SCENES,
  BASE_THEMES,
  type ThemePack,
  type ThemePackOverride,
} from "./theme";

describe("catalog sizes", () => {
  it("ships 8 designs, 8 scenes, 16 palettes, 8 themes", () => {
    expect(DESIGNS).toHaveLength(8);
    expect(SCENES).toHaveLength(8);
    expect(BASE_THEMES).toHaveLength(16);
    expect(THEME_PACKS).toHaveLength(8);
  });
});

describe("resolveThemePacks", () => {
  const override: ThemePack = {
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

  it("replaces a built-in by name, preserving order", () => {
    const resolved = resolveThemePacks([override]);
    expect(resolved).toHaveLength(THEME_PACKS.length);
    const idx = THEME_PACKS.findIndex((p) => p.name === "Mariana");
    expect(resolved[idx]).toEqual(override);
    expect(resolved[idx].design).toBe("flat");
    // Other packs untouched.
    expect(resolved[0]).toEqual(THEME_PACKS[0]);
  });

  it("ignores overrides whose name matches no built-in", () => {
    const stale: ThemePack = { ...override, name: "Nope" };
    expect(resolveThemePacks([stale])).toEqual(THEME_PACKS);
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
