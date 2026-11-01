import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { PrefsProvider, useLookPrefs, type DefaultTheme } from "@/components/PrefsProvider";
import BoardTheme from "@/components/BoardTheme";
import { settingsSchema } from "@/lib/schema";
import { THEME_PACKS } from "@/lib/theme";
import { boardDefaultTheme } from "@/lib/board-theme";

// In "system" mode (the schema default) an OS light/dark flip repaints the
// whole look for the new mode. The listener is made once, on mount, and used
// to paint from the mount's closure (#394): the page-load design, site theme
// and stored parts came back over a design changed in the builder since, a
// pinned board's theme or a schedule phase — while the scene, which follows
// React state, stayed on the current one.

const site: DefaultTheme = { ...settingsSchema.parse({}).theme, mode: "system" };
const circuit = boardDefaultTheme(site, { theme: "Circuit" }, THEME_PACKS);

// The OS scheme under test: `matches` reads it live, as a MediaQueryList
// does, and a flip tells every listener the provider registered.
let osDark = true;
let listeners: Array<() => void> = [];
function flipOs(dark: boolean) {
  osDark = dark;
  act(() => listeners.forEach((l) => l()));
}

function Probe() {
  const { setDesign, resolvedMode, design } = useLookPrefs();
  return (
    <>
      <button onClick={() => setDesign("sketch", "dark")}>sketch</button>
      <p data-testid="look">
        {resolvedMode}/{design}
      </p>
    </>
  );
}

function Tree({ children }: { children?: ReactNode }) {
  return (
    <PrefsProvider
      defaults={{ timezone: "UTC", latitude: 0, longitude: 0, units: "metric" }}
      weatherEnabled={false}
      defaultTheme={site}
    >
      {children}
      <Probe />
    </PrefsProvider>
  );
}

const classes = () => document.documentElement.classList;
const vars = (name: string) => document.documentElement.style.getPropertyValue(name);
const shown = () => screen.getByTestId("look").textContent;

beforeEach(() => {
  osDark = true;
  listeners = [];
  window.localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.className = "";
  window.matchMedia = () =>
    ({
      get matches() {
        return osDark;
      },
      addEventListener(_: string, l: () => void) {
        listeners.push(l);
      },
      removeEventListener(_: string, l: () => void) {
        listeners = listeners.filter((x) => x !== l);
      },
    }) as unknown as MediaQueryList;
});
afterEach(() => {
  listeners = [];
});

describe("an OS light/dark flip in system mode (#394)", () => {
  it("paints a design changed since the page loaded, not the page-load one", () => {
    render(<Tree />);
    expect(classes().contains("design-sketch")).toBe(false);
    act(() => screen.getByText("sketch").click());
    expect(classes().contains("design-sketch")).toBe(true);
    // Light: the light design (the site's), as before.
    flipOs(false);
    expect(classes().contains("theme-light")).toBe(true);
    expect(classes().contains("design-sketch")).toBe(false);
    expect(shown()).toBe("light/glass");
    // Back to dark: the changed design, and the paint agrees with the state.
    flipOs(true);
    expect(classes().contains("theme-light")).toBe(false);
    expect(classes().contains("design-sketch")).toBe(true);
    expect(shown()).toBe("dark/sketch");
  });

  it("keeps a pinned board's theme through the flip, colors included", () => {
    const { rerender } = render(<Tree />);
    expect(vars("--accent-from")).toBe(site.accentFrom);
    // A client-side move onto a board with its own theme (#337).
    rerender(
      <Tree>
        <BoardTheme theme={circuit} />
      </Tree>
    );
    expect(classes().contains("design-bold")).toBe(true);
    expect(vars("--accent-from")).toBe("#34d399");
    flipOs(false);
    expect(classes().contains("theme-light")).toBe(true);
    expect(classes().contains("design-bold")).toBe(true);
    expect(vars("--accent-from")).toBe("#059669");
    expect(shown()).toBe("light/bold");
    flipOs(true);
    expect(classes().contains("theme-light")).toBe(false);
    expect(classes().contains("design-bold")).toBe(true);
    expect(vars("--accent-from")).toBe("#34d399");
    expect(shown()).toBe("dark/bold");
  });
});
