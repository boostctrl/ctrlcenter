import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PrefsProvider, useLookPrefs, type DefaultTheme } from "@/components/PrefsProvider";
import type { ThemePack } from "@/lib/theme";
import * as themeApply from "./themeApply";

// Applying a theme pack calls nine setters, and each used to repaint the
// whole look or every chrome class from the latest state: about nine paints
// a click (#440). A batch paints each kind once, at its end, and still
// within the click, so the page shows the pack as soon as the click is over
// (what applyPack.test.tsx checks).
vi.mock("./themeApply", async (importOriginal) => {
  const real = await importOriginal<typeof import("./themeApply")>();
  return { ...real, applyAll: vi.fn(real.applyAll), applyDesign: vi.fn(real.applyDesign) };
});

const DEFAULT_THEME: DefaultTheme = {
  mode: "dark",
  design: "glass",
  scene: "aurora",
  font: "jakarta",
  accentFrom: "#a5f3fc",
  accentTo: "#4ade80",
};
const PACK: ThemePack = {
  name: "Terminal",
  design: "console",
  scene: "glyphs",
  font: "jetbrains",
  dark: { background: "#0b0f0c", foreground: "#c8f7d4", accentFrom: "#4ade80", accentTo: "#22d3ee" },
  light: { background: "#f2f7f3", foreground: "#14231a", accentFrom: "#15803d", accentTo: "#0e7490" },
};

function Picker() {
  const { applyPack, setDesign } = useLookPrefs();
  return (
    <>
      <button onClick={() => applyPack(PACK, "dark")}>pack</button>
      <button onClick={() => setDesign("flat", "dark")}>flat</button>
    </>
  );
}

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
      <Picker />
    </PrefsProvider>
  );
  vi.mocked(themeApply.applyAll).mockClear();
  vi.mocked(themeApply.applyDesign).mockClear();
});

describe("painting the look (#440)", () => {
  it("paints a theme pack once of each kind", () => {
    act(() => screen.getByText("pack").click());
    expect(themeApply.applyAll).toHaveBeenCalledOnce();
    expect(themeApply.applyDesign).toHaveBeenCalledOnce();
    expect(document.documentElement.classList).toContain("design-console");
  });

  it("still paints a single setter at once", () => {
    act(() => screen.getByText("flat").click());
    expect(themeApply.applyDesign).toHaveBeenCalledOnce();
    expect(themeApply.applyAll).not.toHaveBeenCalled();
    expect(document.documentElement.classList).toContain("design-flat");
  });
});
