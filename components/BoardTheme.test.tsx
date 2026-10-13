import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { PrefsProvider, useLookPrefs, type DefaultTheme } from "./PrefsProvider";
import BoardTheme from "./BoardTheme";
import type { ScheduleProps } from "./prefs/useScheduledTheme";
import { settingsSchema } from "@/lib/schema";
import { THEME_PACKS } from "@/lib/theme";
import { boardDefaultTheme } from "@/lib/board-theme";
import { themeWithPack } from "@/lib/theme-schedule";

// A board's own theme (#337) lasts as long as the board is open — the board
// a visit opened on included. The root layout starts PrefsProvider on that
// board's theme for the first paint, and used to hand it in as the site
// default, which no later page could take back (#385).

const pack = (name: string) => THEME_PACKS.find((p) => p.name === name)!;
// Dark, so every pack's dark design and scene are the ones on screen.
const site: DefaultTheme = { ...settingsSchema.parse({}).theme, mode: "dark" };
const circuit = boardDefaultTheme(site, { theme: "Circuit" }, THEME_PACKS);
const outrun = boardDefaultTheme(site, { theme: "Outrun" }, THEME_PACKS);
// BoardPage hands in its own copy (a separate prop from the server), equal
// to the layout's but not the same object.
const circuitFromPage = structuredClone(circuit);
const schedule: ScheduleProps = {
  config: {
    enabled: true,
    mode: "fixed",
    day: "Frostbite",
    night: "Halftone",
    dayStart: "07:00",
    nightStart: "19:00",
  },
  base: site,
  day: themeWithPack(site, pack("Frostbite")),
  night: themeWithPack(site, pack("Halftone")),
  phase: "day",
  location: { latitude: 0, longitude: 0 },
  timeZone: "UTC",
};

// Every look the tree rendered, in order; the probe shows the latest.
let seen: string[] = [];
function Probe() {
  const { design, scene, themeSchedule } = useLookPrefs();
  const look = `${design}/${scene}`;
  seen.push(look);
  return (
    <p data-testid="look" data-phase={themeSchedule?.phase ?? "none"}>
      {look}
    </p>
  );
}

function Tree({
  initialBoardTheme = null,
  sched = null,
  children,
}: {
  initialBoardTheme?: DefaultTheme | null;
  sched?: ScheduleProps | null;
  children?: ReactNode;
}) {
  // As app/layout.tsx hands it in: the site's theme (the phase's, under a
  // schedule) and, apart from it, the board this load opened on.
  return (
    <PrefsProvider
      defaults={{ timezone: "UTC", latitude: 0, longitude: 0, units: "metric" }}
      weatherEnabled={false}
      defaultTheme={sched ? sched[sched.phase] : site}
      initialBoardTheme={initialBoardTheme}
      schedule={sched}
    >
      {children}
      <Probe />
    </PrefsProvider>
  );
}

const shown = () => screen.getByTestId("look").textContent;
const html = () => document.documentElement.classList;

beforeEach(() => {
  seen = [];
  window.localStorage.clear();
  document.documentElement.className = "";
  // jsdom has no matchMedia; the look reads the OS scheme through it.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }))
  );
  // Noon UTC: the fixed schedule's day phase, on the server's clock and the
  // browser's re-check alike. Only Date is faked; the schedule's timers run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a board's own theme (#337, #385)", () => {
  it("renders the pinned board's theme from the first render, on the server and in the browser", async () => {
    const tree = (
      <Tree initialBoardTheme={circuit}>
        <BoardTheme theme={circuitFromPage} />
      </Tree>
    );
    // What the server sends matches what the no-flash script painted.
    const markup = renderToString(tree);
    expect(markup).toContain("bold/traces");
    const container = document.createElement("div");
    container.innerHTML = markup;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    seen = [];
    const root = await act(async () =>
      hydrateRoot(container, tree, { onRecoverableError: (e) => errors.push(e) })
    );
    expect(errors).toEqual([]);
    // Never the site's look in between: no flash before BoardTheme mounts.
    expect(new Set(seen)).toEqual(new Set(["bold/traces"]));
    expect(html().contains("design-bold")).toBe(true);
    expect(html().contains("scene-traces")).toBe(true);
    act(() => root.unmount());
    container.remove();
  });

  it("lets the first board's theme go on leaving it, back to the site's", () => {
    const { rerender } = render(
      <Tree initialBoardTheme={circuit}>
        <BoardTheme theme={circuitFromPage} />
      </Tree>
    );
    expect(shown()).toBe("bold/traces");
    expect(html().contains("design-bold")).toBe(true);
    // A client-side move to Status, Settings…: the layout's props stay as
    // they were, BoardTheme unmounts.
    rerender(<Tree initialBoardTheme={circuit} />);
    expect(shown()).toBe("glass/aurora");
    expect(html().contains("design-bold")).toBe(false);
    expect(html().contains("scene-traces")).toBe(false);
  });

  it("switches straight from one pinned board to the next, and to none", () => {
    const { rerender } = render(
      <Tree initialBoardTheme={circuit}>
        <BoardTheme key="infra" theme={circuitFromPage} />
      </Tree>
    );
    seen = [];
    rerender(
      <Tree initialBoardTheme={circuit}>
        <BoardTheme key="media" theme={outrun} />
      </Tree>
    );
    expect(shown()).toBe("cyber/grid");
    expect(html().contains("design-cyber")).toBe(true);
    expect(html().contains("design-bold")).toBe(false);
    // The old board's take-back and the new board's theme land together.
    expect(seen).not.toContain("glass/aurora");
    // A board without a theme of its own shows the site's.
    rerender(
      <Tree initialBoardTheme={circuit}>
        <BoardTheme key="home" theme={null} />
      </Tree>
    );
    expect(shown()).toBe("glass/aurora");
    expect(html().contains("design-cyber")).toBe(false);
  });

  it("keeps the day/night schedule running behind a pinned first board", async () => {
    // The server resolved night; the browser's clock says noon, so its first
    // re-check of the phase moves to day — while the pinned board is open.
    const sched: ScheduleProps = { ...schedule, phase: "night" };
    const { rerender } = render(
      <Tree initialBoardTheme={circuit} sched={sched}>
        <BoardTheme theme={circuitFromPage} />
      </Tree>
    );
    expect(shown()).toBe("bold/traces");
    // The visitor's switch is there on every page, the pinned board's too.
    expect(screen.getByTestId("look").dataset.phase).toBe("night");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(screen.getByTestId("look").dataset.phase).toBe("day");
    // The pin still wins on its board.
    expect(shown()).toBe("bold/traces");
    rerender(<Tree initialBoardTheme={circuit} sched={sched} />);
    // Off the board: the current phase's theme, not the board's and not
    // the unscheduled site's.
    expect(shown()).toBe("frost/peaks");
    expect(html().contains("design-frost")).toBe(true);
    expect(html().contains("design-bold")).toBe(false);
  });
});
