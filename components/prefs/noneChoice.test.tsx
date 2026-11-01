import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PrefsProvider, useLookPrefs, type DefaultTheme } from "@/components/PrefsProvider";
import type { ThemePack } from "@/lib/theme";
import type { CustomTheme } from "@/lib/prefs";

// "Nothing chosen" means the site default, so on a site whose default
// carries a tune, scene effects or status colors a visitor could never get
// back to the plain design (#395): the sliders at 100%, "Reset to the
// scene", "Reset to standard" and a pack or saved theme without those parts
// all fell back to the site's. An explicit "none" now clears each part
// outright; null still means the site default. The paint is read straight
// off the document, the way the stylesheet sees it.

const SITE: DefaultTheme = {
  mode: "dark",
  design: "glass",
  scene: "aurora",
  font: "jakarta",
  accentFrom: "#a5f3fc",
  accentTo: "#4ade80",
  tune: { radius: 50, border: 100, blur: 100, shadow: 100, fill: 100, glow: 100 },
  sceneMotion: "calm",
  status: { up: "#00ff00", down: "#ff0000", warning: "#ffaa00", info: "#00aaff" },
};

const colors = {
  dark: { background: "#171512", foreground: "#ebe5d8", accentFrom: "#e8b04b", accentTo: "#d9674f" },
  light: { background: "#f4efe4", foreground: "#2a2521", accentFrom: "#b7791f", accentTo: "#b4473a" },
};
const PLAIN_PACK: ThemePack = { name: "Plain", design: "flat", scene: "rain", ...colors };
const PLAIN_SAVED: CustomTheme = {
  id: "t1",
  name: "Plain",
  design: "sketch",
  scene: "topography",
  font: "jakarta",
  designLight: "flat",
  sceneLight: "none",
  fontLight: "jakarta",
  ...colors,
};
const TUNE = { radius: 140, border: 100, blur: 100, shadow: 100, fill: 100, glow: 100 };

function Probe() {
  const look = useLookPrefs();
  return (
    <>
      <button onClick={() => look.applyPack(PLAIN_PACK, "dark")}>pack</button>
      <button onClick={() => look.adoptTheme(PLAIN_SAVED)}>saved</button>
      <button onClick={() => look.setTune("none", "dark")}>tune none</button>
      <button onClick={() => look.setTune(TUNE, "dark")}>tune own</button>
      <button onClick={() => look.setTune(null, "dark")}>tune site</button>
      <button onClick={() => look.setSceneFx("none", "dark")}>fx none</button>
      <button onClick={() => look.setSceneFx(null, "dark")}>fx site</button>
      <button onClick={() => look.setStatusColors("none", "dark")}>status none</button>
      <button onClick={() => look.setStatusColors(null, "dark")}>status site</button>
      <button onClick={() => look.resetTheme()}>reset theme</button>
      <p data-testid="state">
        {look.tuneFor("dark") ? "tuned" : "plain"}/{look.sceneFxFor("dark")?.motion ?? "designed"}/
        {look.statusFor("dark") ? "colored" : "standard"}
      </p>
    </>
  );
}

const html = () => document.documentElement;
const vars = (name: string) => html().style.getPropertyValue(name);
const state = () => screen.getByTestId("state").textContent;
const mount = () =>
  render(
    <PrefsProvider
      defaults={{ timezone: "UTC", latitude: 0, longitude: 0, units: "metric" }}
      weatherEnabled={false}
      defaultTheme={SITE}
    >
      <Probe />
    </PrefsProvider>
  );

beforeEach(() => {
  window.localStorage.clear();
  html().removeAttribute("style");
  html().removeAttribute("data-motion");
  html().className = "";
  // jsdom has no matchMedia; "dark" mode never consults it, but the
  // provider's mount listener does.
  window.matchMedia = () =>
    ({ matches: true, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

describe("an explicit none over the site default (#395)", () => {
  it("starts on the site's tune, effects and status colors", () => {
    mount();
    expect(vars("--tune-radius")).toBe("0.5");
    expect(html().getAttribute("data-motion")).toBe("calm");
    expect(vars("--status-up")).toBe("#00ff00");
    expect(state()).toBe("tuned/calm/colored");
  });

  it("clears each part with none, and null brings the site's back", () => {
    mount();
    act(() => screen.getByText("tune none").click());
    expect(vars("--tune-radius")).toBe("");
    act(() => screen.getByText("fx none").click());
    expect(html().getAttribute("data-motion")).toBeNull();
    act(() => screen.getByText("status none").click());
    expect(vars("--status-up")).toBe("");
    expect(state()).toBe("plain/designed/standard");
    act(() => screen.getByText("tune site").click());
    act(() => screen.getByText("fx site").click());
    act(() => screen.getByText("status site").click());
    expect(vars("--tune-radius")).toBe("0.5");
    expect(html().getAttribute("data-motion")).toBe("calm");
    expect(vars("--status-up")).toBe("#00ff00");
    expect(state()).toBe("tuned/calm/colored");
  });

  it("lands a pack without those parts as designed, not on the site's", () => {
    mount();
    act(() => screen.getByText("pack").click());
    expect(html().classList.contains("design-flat")).toBe(true);
    expect(vars("--tune-radius")).toBe("");
    expect(html().getAttribute("data-motion")).toBeNull();
    expect(vars("--status-up")).toBe("");
    expect(state()).toBe("plain/designed/standard");
  });

  it("restores a saved theme exactly as captured, the parts it lacks included", () => {
    mount();
    act(() => screen.getByText("tune own").click());
    expect(vars("--tune-radius")).toBe("1.4");
    act(() => screen.getByText("saved").click());
    expect(html().classList.contains("design-sketch")).toBe(true);
    expect(vars("--tune-radius")).toBe("");
    expect(html().getAttribute("data-motion")).toBeNull();
    expect(vars("--status-up")).toBe("");
    expect(state()).toBe("plain/designed/standard");
  });

  it("reads a stored none on the next load, as the no-flash script does", () => {
    window.localStorage.setItem("ctrlcenter:tune", JSON.stringify({ dark: "none", light: null }));
    window.localStorage.setItem("ctrlcenter:scene-fx", JSON.stringify({ dark: "none", light: null }));
    window.localStorage.setItem("ctrlcenter:status", JSON.stringify({ dark: "none", light: null }));
    mount();
    expect(vars("--tune-radius")).toBe("");
    expect(html().getAttribute("data-motion")).toBeNull();
    expect(vars("--status-up")).toBe("");
    expect(state()).toBe("plain/designed/standard");
  });

  it("goes back to the site's with Reset theme", () => {
    mount();
    act(() => screen.getByText("pack").click());
    expect(state()).toBe("plain/designed/standard");
    act(() => screen.getByText("reset theme").click());
    expect(vars("--tune-radius")).toBe("0.5");
    expect(html().getAttribute("data-motion")).toBe("calm");
    expect(vars("--status-up")).toBe("#00ff00");
    expect(state()).toBe("tuned/calm/colored");
  });
});
