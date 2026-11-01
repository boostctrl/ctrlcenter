import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { PrefsProvider, useFavorites, useLookPrefs, type DefaultTheme } from "@/components/PrefsProvider";
import type { ScheduleProps } from "./useScheduledTheme";
import { settingsSchema } from "@/lib/schema";
import { THEME_PACKS, type VisitorTheming } from "@/lib/theme";
import { themeWithPack } from "@/lib/theme-schedule";

// The visitor's day/night schedule switch (#336, #395): read with the first
// paint and under the theming policy, as the no-flash script reads it, so a
// visitor who turned the schedule off never sees the phase's theme flash;
// cleared by the global reset; and handed out as one stable value, so the
// look's consumers don't re-render for every unrelated change (#290).

const pack = (name: string) => THEME_PACKS.find((p) => p.name === name)!;
const site: DefaultTheme = { ...settingsSchema.parse({}).theme, mode: "dark" };
const schedule: ScheduleProps = {
  config: {
    enabled: true,
    mode: "fixed",
    day: "Frostbite",
    night: "Halftone",
    dayStart: "07:00",
    nightStart: "19:00",
    dayMode: "light",
  },
  base: site,
  // The day phase brings its own mode (light) along with its pack.
  day: themeWithPack(site, pack("Frostbite"), "light"),
  night: themeWithPack(site, pack("Halftone")),
  phase: "day",
  location: { latitude: 0, longitude: 0 },
  timeZone: "UTC",
};

// How many distinct look values the probe has been handed (one per mount,
// then one per real change).
let lookIdentities = 0;
function Probe() {
  const look = useLookPrefs();
  const { toggleFavorite } = useFavorites();
  useEffect(() => {
    lookIdentities++;
  }, [look]);
  const sched = look.themeSchedule;
  return (
    <>
      <button onClick={() => sched?.setFollow(false)}>off</button>
      <button onClick={() => sched?.setFollow(true)}>follow</button>
      <button onClick={() => look.reset()}>reset</button>
      <button onClick={() => toggleFavorite("x")}>fav</button>
      <p data-testid="state">
        {look.resolvedMode}/{look.design}/{sched ? (sched.follow ? "follow" : "off") : "none"}
      </p>
    </>
  );
}

function Tree({ policy = "all" }: { policy?: VisitorTheming }) {
  return (
    <PrefsProvider
      defaults={{ timezone: "UTC", latitude: 0, longitude: 0, units: "metric" }}
      weatherEnabled={false}
      defaultTheme={schedule.day}
      visitorTheming={policy}
      schedule={schedule}
    >
      <Probe />
    </PrefsProvider>
  );
}

const html = () => document.documentElement;
const shown = () => screen.getByTestId("state").textContent;
// Every class ever added to <html> during the test: a phase design that
// shows up here and not on the element was painted and then painted over.
let added: string[] = [];

beforeEach(() => {
  window.localStorage.clear();
  html().removeAttribute("style");
  html().className = "";
  added = [];
  const list = html().classList;
  const add = list.add.bind(list);
  list.add = (...tokens: string[]) => {
    added.push(...tokens);
    add(...tokens);
  };
  lookIdentities = 0;
  // jsdom has no matchMedia; the look reads the OS scheme through it.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }))
  );
  // Noon UTC: the fixed schedule's day phase on the browser's re-check too.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the day/night schedule switch (#336, #395)", () => {
  it("follows the schedule by default: the phase's design and mode", () => {
    render(<Tree />);
    expect(html().classList.contains("design-frost")).toBe(true);
    expect(html().classList.contains("theme-light")).toBe(true);
    expect(shown()).toBe("light/frost/follow");
  });

  it("paints the site's usual theme from the first paint when the switch is off, never the phase's", () => {
    window.localStorage.setItem("ctrlcenter:schedule", "off");
    render(<Tree />);
    expect(html().classList.contains("design-frost")).toBe(false);
    expect(html().classList.contains("theme-light")).toBe(false);
    expect(added).not.toContain("design-frost");
    expect(shown()).toBe("dark/glass/off");
  });

  it("ignores the stored switch under the \"nothing\" policy, as the no-flash script does", () => {
    window.localStorage.setItem("ctrlcenter:schedule", "off");
    render(<Tree policy="none" />);
    expect(html().classList.contains("design-frost")).toBe(true);
    expect(shown()).toBe("light/frost/follow");
  });

  it("switches at once, mode included, and remembers the choice", () => {
    render(<Tree />);
    act(() => screen.getByText("off").click());
    expect(html().classList.contains("design-frost")).toBe(false);
    expect(html().classList.contains("theme-light")).toBe(false);
    expect(shown()).toBe("dark/glass/off");
    expect(window.localStorage.getItem("ctrlcenter:schedule")).toBe("off");
    act(() => screen.getByText("follow").click());
    expect(html().classList.contains("design-frost")).toBe(true);
    expect(html().classList.contains("theme-light")).toBe(true);
    expect(shown()).toBe("light/frost/follow");
    expect(window.localStorage.getItem("ctrlcenter:schedule")).toBeNull();
  });

  it("is cleared by Reset all settings", () => {
    window.localStorage.setItem("ctrlcenter:schedule", "off");
    render(<Tree />);
    expect(shown()).toBe("dark/glass/off");
    act(() => screen.getByText("reset").click());
    expect(window.localStorage.getItem("ctrlcenter:schedule")).toBeNull();
    expect(html().classList.contains("design-frost")).toBe(true);
    expect(shown()).toBe("light/frost/follow");
  });

  it("hands the look out unchanged across an unrelated change (#290)", () => {
    render(<Tree />);
    const after = lookIdentities;
    act(() => screen.getByText("fav").click());
    expect(lookIdentities).toBe(after);
    // A real change still comes through.
    act(() => screen.getByText("off").click());
    expect(lookIdentities).toBe(after + 1);
  });
});
