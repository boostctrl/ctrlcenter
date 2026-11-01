import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PrefsProvider, useLookPrefs, type DefaultTheme } from "@/components/PrefsProvider";
import type { CustomTheme } from "@/lib/prefs";

// Several look setters in one handler (#429): each paints from the latest
// state, so the later ones paint what the earlier ones just set, not this
// render's values. Each setter used to paint from its render's closure, and a
// handler calling two of them got the first part painted back to the value
// from before the click (#363, #373, #394 were all this bug). The paint is
// read straight off the document, the way the stylesheet sees it.

const DEFAULT_THEME: DefaultTheme = {
  mode: "dark",
  design: "glass",
  scene: "aurora",
  font: "jakarta",
  accentFrom: "#a5f3fc",
  accentTo: "#4ade80",
};

const TUNE = { radius: 140, fill: 100, border: 100, blur: 100, shadow: 100, glow: 100 };
const STATUS = { up: "#11aa77", down: "#cc3344", warning: "#ddaa00", info: "#2299dd" };
const WALLPAPER = { src: "/backgrounds/linen.svg", blur: 0, dim: 0, fit: "tile" as const };
const SAVED: CustomTheme = {
  id: "t1",
  name: "Saved",
  design: "sketch",
  scene: "topography",
  font: "jetbrains",
  designLight: "flat",
  sceneLight: "none",
  fontLight: "jakarta",
  dark: { background: "#171512", foreground: "#ebe5d8", accentFrom: "#e8b04b", accentTo: "#d9674f" },
  light: { background: "#f4efe4", foreground: "#2a2521", accentFrom: "#b7791f", accentTo: "#b4473a" },
  tune: TUNE,
  density: "spacious",
};

function Probe() {
  const look = useLookPrefs();
  return (
    <>
      <button
        onClick={() => {
          look.setTune(TUNE, "dark");
          look.setDensity("compact", "dark");
        }}
      >
        tune+density
      </button>
      <button
        onClick={() => {
          look.setStatusColors(STATUS, "dark");
          look.setWallpaper(WALLPAPER, "dark");
        }}
      >
        status+wallpaper
      </button>
      <button
        onClick={() => {
          look.setDesign("sketch", "light");
          look.setTheme("light");
        }}
      >
        design+mode
      </button>
      <button
        onClick={() => {
          look.setBaseColors("#101010", "#fafafa", true);
          look.setTune(TUNE, "dark");
        }}
      >
        colors+tune
      </button>
      <button onClick={() => look.adoptTheme(SAVED)}>adopt</button>
      <p data-testid="state">
        {look.resolvedMode}/{look.designFor("light")}/{look.densityFor("dark")}
      </p>
    </>
  );
}

const html = () => document.documentElement;
const vars = (name: string) => html().style.getPropertyValue(name);

beforeEach(() => {
  window.localStorage.clear();
  html().removeAttribute("style");
  html().className = "";
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
      <Probe />
    </PrefsProvider>
  );
});

describe("two look setters in one handler (#429)", () => {
  it("paints both parts: the second setter doesn't paint the first's back", () => {
    act(() => screen.getByText("tune+density").click());
    expect(vars("--tune-radius")).toBe("1.4");
    expect(vars("--density")).toBe("0.85");
    expect(screen.getByTestId("state").textContent).toBe("dark/glass/compact");
  });

  it("paints status colors and a wallpaper set together", () => {
    act(() => screen.getByText("status+wallpaper").click());
    expect(vars("--status-up")).toBe("#11aa77");
    expect(vars("--wallpaper-image")).toContain("linen.svg");
  });

  it("paints a design set for a mode just before switching to that mode", () => {
    act(() => screen.getByText("design+mode").click());
    expect(html().classList.contains("theme-light")).toBe(true);
    expect(html().classList.contains("design-sketch")).toBe(true);
    expect(screen.getByTestId("state").textContent).toBe("light/sketch/comfortable");
  });

  it("keeps colors set a moment before a tune edit", () => {
    act(() => screen.getByText("colors+tune").click());
    expect(vars("--background")).toBe("#101010");
    expect(vars("--tune-radius")).toBe("1.4");
  });

  it("restores a saved theme's tune, density and chrome in the same click", () => {
    act(() => screen.getByText("adopt").click());
    expect(vars("--background")).toBe("#171512");
    expect(vars("--tune-radius")).toBe("1.4");
    expect(vars("--density")).toBe("1.15");
    expect(html().classList.contains("design-sketch")).toBe(true);
    expect(html().classList.contains("scene-topography")).toBe(true);
    expect(html().classList.contains("font-jetbrains")).toBe(true);
  });
});
