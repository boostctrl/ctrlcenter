import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PrefsProvider, useLookPrefs, type DefaultTheme } from "@/components/PrefsProvider";
import type { ThemePack } from "@/lib/theme";

// Applying a site theme from the Themes tab (#363): every part it carries —
// the wallpaper above all — must be on <html> once the click has run, not
// after the next unrelated repaint. The paint is read straight off the
// document, the way the stylesheet sees it.

const DEFAULT_THEME: DefaultTheme = {
  mode: "dark",
  design: "glass",
  scene: "aurora",
  font: "jakarta",
  accentFrom: "#a5f3fc",
  accentTo: "#4ade80",
};

const colors = {
  dark: { background: "#171512", foreground: "#ebe5d8", accentFrom: "#e8b04b", accentTo: "#d9674f" },
  light: { background: "#f4efe4", foreground: "#2a2521", accentFrom: "#b7791f", accentTo: "#b4473a" },
};
const WITH_WALLPAPER: ThemePack = {
  name: "Atelier",
  design: "sketch",
  scene: "topography",
  wallpaper: { src: "/backgrounds/linen.svg", blur: 0, dim: 0, fit: "tile" },
  wallpaperLight: { src: "/backgrounds/linen.svg", blur: 0, dim: 0, fit: "tile" },
  status: { up: "#11aa77", down: "#cc3344", warning: "#ddaa00", info: "#2299dd" },
  tune: { radius: 140, fill: 100, border: 100, blur: 100, shadow: 100, glow: 100 },
  ...colors,
};
const WITHOUT: ThemePack = { name: "Plain", design: "flat", scene: "none", ...colors };

function Picker() {
  const { applyPack } = useLookPrefs();
  return (
    <>
      <button onClick={() => applyPack(WITH_WALLPAPER, "dark")}>wallpaper</button>
      <button onClick={() => applyPack(WITHOUT, "dark")}>plain</button>
    </>
  );
}

const html = () => document.documentElement.style;

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("style");
  // jsdom has no matchMedia; "dark" mode never consults it, but the
  // provider's mount listener does.
  window.matchMedia = () =>
    ({ matches: true, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  render(
    <PrefsProvider
      defaults={{ timezone: "UTC", latitude: 0, longitude: 0, units: "metric" }}
      weatherEnabled={false}
      defaultTheme={DEFAULT_THEME}
    >
      <Picker />
    </PrefsProvider>
  );
});

describe("applying a theme pack (#363)", () => {
  it("paints the pack's wallpaper at once, and clears it for a pack without one", () => {
    expect(html().getPropertyValue("--wallpaper-image")).toBe("");
    act(() => screen.getByText("wallpaper").click());
    expect(html().getPropertyValue("--wallpaper-image")).toContain("linen.svg");
    act(() => screen.getByText("plain").click());
    expect(html().getPropertyValue("--wallpaper-image")).toBe("");
  });

  it("paints the pack's tune and status colors in the same click", () => {
    act(() => screen.getByText("wallpaper").click());
    expect(html().getPropertyValue("--tune-radius")).toBe("1.4");
    expect(html().getPropertyValue("--status-up")).toBe("#11aa77");
    act(() => screen.getByText("plain").click());
    expect(html().getPropertyValue("--tune-radius")).not.toBe("1.4");
    expect(html().getPropertyValue("--status-up")).not.toBe("#11aa77");
  });
});
