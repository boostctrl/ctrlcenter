import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PrefsProvider, type DefaultTheme } from "@/components/PrefsProvider";
import { derivePalette } from "@/lib/color";
import { useThemeDraft } from "./useThemeDraft";

// "Build a palette from this accent" (#332) sets both modes' colors and
// status colors in one click. The colors painted first, and each status
// setter then repainted from this render's look and accent — the values from
// before the click — so the page kept the old colors under the new status
// colors while the pickers showed the new palette (#394). The paint is read
// straight off the document, the way the stylesheet sees it.

const DEFAULT_THEME: DefaultTheme = {
  mode: "dark",
  design: "glass",
  scene: "aurora",
  font: "jakarta",
  accentFrom: "#a5f3fc",
  accentTo: "#4ade80",
};

function Builder() {
  const d = useThemeDraft();
  return (
    <>
      <button onClick={() => d.autoPair()}>pair</button>
      <p data-testid="status">{d.statusFor("dark")?.up ?? "none"}</p>
    </>
  );
}

const html = () => document.documentElement.style;

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.className = "";
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
      <Builder />
    </PrefsProvider>
  );
});

describe("building a palette from the accent (#394)", () => {
  it("paints the derived colors and status colors together, in the same click", () => {
    // The pickers start on the site accent, so that's what the palette is built from.
    const derived = derivePalette(DEFAULT_THEME.accentFrom);
    expect(html().getPropertyValue("--accent-from")).toBe(DEFAULT_THEME.accentFrom);
    act(() => screen.getByText("pair").click());
    expect(html().getPropertyValue("--accent-from")).toBe(derived.dark.accentFrom);
    expect(html().getPropertyValue("--accent-to")).toBe(derived.dark.accentTo);
    expect(html().getPropertyValue("--background")).toBe(derived.dark.background);
    expect(html().getPropertyValue("--foreground")).toBe(derived.dark.foreground);
    expect(html().getPropertyValue("--status-up")).toBe(derived.status.up);
    expect(html().getPropertyValue("--status-down")).toBe(derived.status.down);
    // The state behind the pickers agrees with the paint.
    expect(screen.getByTestId("status").textContent).toBe(derived.status.up);
  });
});
