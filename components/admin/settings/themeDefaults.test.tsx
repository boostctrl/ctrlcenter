import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { settingsSchema, type Settings } from "@/lib/schema";
import { THEME_PACKS, type ThemePack } from "@/lib/theme";
import { useSettingsDraft } from "./useSettingsDraft";

// The site default theme's fonts (#471). A pack applied as the default keeps
// the admin's body and heading fonts unless it carries its own, and light
// mode's own fonts are cleared whenever light goes back to following dark.

const plain: ThemePack = { ...THEME_PACKS[0], name: "Plain", font: undefined, headingFont: undefined };
const typeset: ThemePack = { ...THEME_PACKS[0], name: "Typeset", font: "lora", headingFont: "poppins" };

function setup(theme: Partial<Settings["theme"]> = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  const base = settingsSchema.parse({});
  const settings = { ...base, theme: { ...base.theme, ...theme } };
  return renderHook(() => useSettingsDraft(settings, [], [], [], [plain, typeset]));
}

afterEach(() => vi.unstubAllGlobals());

describe("site default theme fonts (#471)", () => {
  it("keeps the admin's heading font when the pack carries none", () => {
    const { result } = setup({ font: "inter", headingFont: "jetbrains" });
    act(() => result.current.applyDefaultTheme("Plain"));
    expect(result.current.settings.theme.font).toBe("inter");
    expect(result.current.settings.theme.headingFont).toBe("jetbrains");
  });

  it("takes the pack's fonts when it carries them", () => {
    const { result } = setup({ font: "inter", headingFont: "jetbrains" });
    act(() => result.current.applyDefaultTheme("Typeset"));
    expect(result.current.settings.theme.font).toBe("lora");
    expect(result.current.settings.theme.headingFont).toBe("poppins");
  });

  it("clears light mode's font when a new dark default is applied", () => {
    const { result } = setup({ fontLight: "nunito" });
    act(() => result.current.applyDefaultTheme("Plain"));
    expect(result.current.settings.theme.fontLight).toBeUndefined();
  });

  it("clears light mode's font when light goes back to following dark", () => {
    const { result } = setup({ preset: "Plain" });
    act(() => result.current.applyLightDefault("Typeset"));
    expect(result.current.settings.theme.fontLight).toBe("lora");
    act(() => result.current.applyLightDefault(""));
    expect(result.current.settings.theme.fontLight).toBeUndefined();
    expect(result.current.settings.theme.headingFontLight).toBeUndefined();
  });
});
