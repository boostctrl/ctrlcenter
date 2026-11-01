import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { PrefsProvider, type DefaultTheme } from "@/components/PrefsProvider";
import { BASE_THEMES, BUNDLED_BACKGROUNDS, DESIGNS, THEME_PACKS } from "@/lib/theme";
import { FONTS } from "@/lib/fonts";
import { THEMES_KEY } from "@/lib/prefs";
import { useThemeDraft, type ThemeDraft } from "./useThemeDraft";
import { SCENE_ROWS } from "./sceneFamilies";
import ColorsTab from "./ColorsTab";
import DesignTab from "./DesignTab";
import FontTab from "./FontTab";
import SceneTab from "./SceneTab";
import ThemesTab from "./ThemesTab";

// Every grid of option tiles is a named group (#350), so a screen reader
// hears the heading that names the set before its buttons: the Scene tab's
// family rows and the wallpaper patterns set the pattern, and the design,
// font, palette and theme grids follow it.

const DEFAULT_THEME: DefaultTheme = {
  mode: "dark",
  design: "glass",
  scene: "aurora",
  font: "jakarta",
  accentFrom: "#a5f3fc",
  accentTo: "#4ade80",
};

// One saved theme, so the "Your themes" grid renders.
const SAVED = {
  id: "t1",
  name: "Lagoon",
  design: "flat",
  scene: "dots",
  font: "inter",
  dark: { background: "#000000", foreground: "#ffffff", accentFrom: "#a78bfa", accentTo: "#22d3ee" },
  light: { background: "#ffffff", foreground: "#000000", accentFrom: "#a78bfa", accentTo: "#22d3ee" },
};

function Tab({ children }: { children: (d: ThemeDraft) => ReactNode }) {
  return children(useThemeDraft());
}

function renderTab(tab: (d: ThemeDraft) => ReactNode) {
  return render(
    <PrefsProvider
      defaults={{ timezone: "UTC", latitude: 0, longitude: 0, units: "metric" }}
      weatherEnabled={false}
      defaultTheme={DEFAULT_THEME}
    >
      <Tab>{tab}</Tab>
    </PrefsProvider>
  );
}

// The option tiles in a group: the buttons that carry a pressed state, as
// opposed to a tile's rename or delete buttons.
const tiles = (group: HTMLElement) =>
  within(group)
    .getAllByRole("button")
    .filter((b) => b.hasAttribute("aria-pressed"));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(THEMES_KEY, JSON.stringify([SAVED]));
  document.documentElement.removeAttribute("style");
  document.documentElement.className = "";
  // jsdom has no matchMedia; "dark" mode never consults it, but the
  // provider's mount listener does.
  window.matchMedia = () =>
    ({ matches: true, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

describe("the theme builder's option grids are named groups (#350)", () => {
  it("names the design tiles by the line introducing them", () => {
    renderTab((d) => <DesignTab d={d} />);
    const group = screen.getByRole("group", {
      name: "How cards & panels are drawn — the surface style of your dark theme.",
    });
    expect(tiles(group)).toHaveLength(DESIGNS.length);
    expect(within(group).getByRole("button", { name: /^Glass/ })).toBeTruthy();
  });

  it("names the body font tiles by their intro and the heading font tiles by their heading", () => {
    renderTab((d) => <FontTab d={d} />);
    const body = screen.getByRole("group", { name: "The interface typeface of your dark theme." });
    expect(tiles(body)).toHaveLength(FONTS.length);
    const headings = screen.getByRole("group", { name: "Headings" });
    expect(tiles(headings)).toHaveLength(FONTS.length + 1);
    expect(within(headings).getByRole("button", { name: "Body font" })).toBeTruthy();
  });

  it("names the palette tiles by their heading", () => {
    renderTab((d) => <ColorsTab d={d} />);
    const group = screen.getByRole("group", { name: "Palettes" });
    expect(tiles(group)).toHaveLength(BASE_THEMES.length);
    expect(within(group).getByRole("button", { name: "Mono" })).toBeTruthy();
  });

  it("names the theme packs by their first sentence and the saved themes by their heading", () => {
    renderTab((d) => <ThemesTab d={d} packs={THEME_PACKS} />);
    const packs = screen.getByRole("group", {
      name: "Curated looks — one tap sets the design, scene & colors of your dark theme.",
    });
    expect(tiles(packs)).toHaveLength(THEME_PACKS.length);
    expect(within(packs).getByRole("button", { name: /^Mariana/ })).toBeTruthy();
    // The advice after the first sentence still reads in full on the page.
    expect(
      screen.getByText(/Tweak it in the other tabs, then name & save your own below\./)
    ).toBeTruthy();
    const saved = screen.getByRole("group", { name: "Your themes" });
    expect(tiles(saved)).toHaveLength(1);
    expect(within(saved).getByRole("button", { name: /^Lagoon/ })).toBeTruthy();
    expect(within(saved).getByRole("button", { name: "Delete Lagoon" })).toBeTruthy();
  });

  it("names each scene family row and the wallpaper patterns", () => {
    renderTab((d) => <SceneTab d={d} />);
    for (const row of SCENE_ROWS) {
      expect(tiles(screen.getByRole("group", { name: row.name }))).toHaveLength(row.scenes.length);
    }
    const patterns = screen.getByRole("group", { name: "Pattern" });
    expect(tiles(patterns)).toHaveLength(BUNDLED_BACKGROUNDS.length + 1);
    expect(within(patterns).getByRole("button", { name: /^None/ })).toBeTruthy();
  });
});
