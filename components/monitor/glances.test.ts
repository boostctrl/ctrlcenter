import { describe, it, expect } from "vitest";
import type { ArrHealthItem } from "@/lib/services/arr";
import { GLANCES } from "./glances";

const NOW = Date.parse("2026-11-14T12:00:00Z");

// An *arr instance with nothing landed this week, so the tile falls back to
// its schedule and health lines.
const quiet = (health: ArrHealthItem["type"][]) => ({
  upcoming: [],
  recent: [],
  health: health.map((type) => ({ type, message: `a ${type}` })),
});

describe("Sonarr and Radarr glance health line", () => {
  // #491: every health entry was counted as a warning, errors and notices too.
  it("counts errors as errors, not warnings", () => {
    const g = GLANCES.sonarr(quiet(["error"]), NOW);
    expect(g.alert).toBe(true);
    expect(g.lines).toEqual(["No recent activity", "1 error"]);
  });

  it("counts only warnings as warnings", () => {
    expect(GLANCES.radarr(quiet(["warning", "notice", "warning"]), NOW).lines).toEqual([
      "No recent activity",
      "2 warnings",
    ]);
  });

  it("leaves a notice out of the count", () => {
    const g = GLANCES.sonarr(quiet(["notice"]), NOW);
    expect(g.alert).toBe(false);
    expect(g.lines).toEqual(["No recent activity"]);
  });
});
