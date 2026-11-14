import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PrefsProvider, useLookPrefs, type DefaultTheme } from "@/components/PrefsProvider";
import { ACCENT_KEY } from "@/lib/prefs";
import type { ModeColors } from "@/lib/theme";

// Standalone accent overrides are per mode (#477): filling one mode's colors
// from a pack or a colour set drops that mode's override in favor of the
// set's own accent, and leaves the other mode's override alone.

const DEFAULT_THEME: DefaultTheme = {
  mode: "dark",
  design: "glass",
  scene: "aurora",
  font: "jakarta",
  accentFrom: "#a5f3fc",
  accentTo: "#4ade80",
};

const SET: ModeColors = {
  dark: { background: "#101010", foreground: "#fafafa", accentFrom: "#111111", accentTo: "#222222" },
  light: { background: "#fafafa", foreground: "#101010", accentFrom: "#333333", accentTo: "#444444" },
};

function Probe() {
  const look = useLookPrefs();
  return (
    <>
      <button onClick={() => look.setAccentOverride({ from: "#ff0000", to: "#00ff00" }, "light")}>
        light accent
      </button>
      <button onClick={() => look.setAccentOverride({ from: "#0000ff", to: "#00ffff" }, "dark")}>
        dark accent
      </button>
      <button onClick={() => look.applyThemeColors(SET, "dark")}>fill dark</button>
      <button onClick={() => look.applyThemeColors(SET)}>fill both</button>
      <p data-testid="accents">{JSON.stringify(look.accentOverride)}</p>
    </>
  );
}

const accents = () => JSON.parse(screen.getByTestId("accents").textContent ?? "{}");
const stored = () => JSON.parse(window.localStorage.getItem(ACCENT_KEY) ?? "null");

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.className = "";
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

describe("accent overrides across a one-mode colour fill (#477)", () => {
  it("keeps the other mode's accent when one mode's colors are applied", () => {
    act(() => screen.getByText("light accent").click());
    act(() => screen.getByText("dark accent").click());
    act(() => screen.getByText("fill dark").click());
    const light = { from: "#ff0000", to: "#00ff00" };
    expect(accents()).toEqual({ dark: null, light });
    expect(stored()).toEqual({ dark: null, light });
  });

  it("drops both when a whole saved theme's colors are applied", () => {
    act(() => screen.getByText("light accent").click());
    act(() => screen.getByText("dark accent").click());
    act(() => screen.getByText("fill both").click());
    expect(accents()).toEqual({ dark: null, light: null });
    expect(stored()).toBeNull();
  });
});
