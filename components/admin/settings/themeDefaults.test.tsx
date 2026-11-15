import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { settingsSchema, type Settings } from "@/lib/schema";
import { THEME_PACKS, type ThemePack } from "@/lib/theme";
import { useSettingsDraft } from "./useSettingsDraft";
import GeneralSection from "./GeneralSection";

// The General section's wallpaper fields read the look; a stand-in will do.
vi.mock("@/components/PrefsProvider", async (original) => ({
  ...(await original<typeof import("@/components/PrefsProvider")>()),
  useLookPrefs: () => ({ surfaceIsLight: false }),
}));

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

// #446: the default theme and the light mode look were recorded and matched
// by the pack's name, so renaming a saved pack left both pickers on nothing.
describe("site default theme by pack key (#446)", () => {
  const mine: ThemePack = { ...THEME_PACKS[0], key: "custom-ab12cd34", name: "Mine" };
  const night: ThemePack = { ...THEME_PACKS[1], key: "custom-cd56ef78", name: "Night" };
  const draft = (theme: Partial<Settings["theme"]>, packs: ThemePack[]) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    const base = settingsSchema.parse({});
    const settings = { ...base, theme: { ...base.theme, ...theme } };
    return renderHook(() => useSettingsDraft(settings, [], [], [], packs));
  };

  it("records the packs by key", () => {
    const { result } = draft({}, [mine, night]);
    act(() => result.current.applyDefaultTheme("custom-ab12cd34"));
    act(() => result.current.applyLightDefault("custom-cd56ef78"));
    expect(result.current.settings.theme.preset).toBe("custom-ab12cd34");
    expect(result.current.settings.theme.presetLight).toBe("custom-cd56ef78");
  });

  function Picker({ theme, packs }: { theme: Partial<Settings["theme"]>; packs: ThemePack[] }) {
    const base = settingsSchema.parse({});
    const d = useSettingsDraft({ ...base, theme: { ...base.theme, ...theme } }, [], [], [], packs);
    return <GeneralSection d={d} themePacks={packs} />;
  }
  const selected = (label: string) =>
    (screen.getByRole("combobox", { name: new RegExp(`^${label}`) }) as HTMLSelectElement).selectedOptions[0]
      ?.textContent;

  it("keeps the pickers on a pack after it's renamed", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    const renamed = [{ ...mine, name: "Mine, renamed" }, { ...night, name: "Night, renamed" }];
    render(<Picker theme={{ preset: "custom-ab12cd34", presetLight: "custom-cd56ef78" }} packs={renamed} />);
    expect(selected("Default theme")).toBe("Mine, renamed");
    expect(selected("Light mode look")).toBe("Night, renamed");
  });

  it("still selects a pack a config from before keys names", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    render(<Picker theme={{ preset: "Mine", presetLight: "Night" }} packs={[mine, night]} />);
    expect(selected("Default theme")).toBe("Mine");
    expect(selected("Light mode look")).toBe("Night");
  });
});
