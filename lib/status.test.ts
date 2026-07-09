import { describe, it, expect } from "vitest";
import {
  summarize,
  matchesStatus,
  statusMessage,
  formatBarLabel,
  formatSince,
} from "./status";

const up = { up: true };
const down = { up: false };

describe("summarize", () => {
  it("reports all up", () => {
    expect(summarize([up, up, up])).toEqual({
      up: 3,
      down: 0,
      total: 3,
      allUp: true,
    });
  });

  it("counts the down services", () => {
    expect(summarize([up, down, up, down])).toEqual({
      up: 2,
      down: 2,
      total: 4,
      allUp: false,
    });
  });

  it("treats empty input as not-all-up (nothing to report)", () => {
    expect(summarize([])).toEqual({ up: 0, down: 0, total: 0, allUp: false });
  });
});

describe("matchesStatus", () => {
  it("matches anything for an empty/blank spec", () => {
    expect(matchesStatus(200, "")).toBe(true);
    expect(matchesStatus(500, "   ")).toBe(true);
    expect(matchesStatus(404, "")).toBe(true);
  });

  it("matches single codes", () => {
    expect(matchesStatus(200, "200")).toBe(true);
    expect(matchesStatus(204, "200, 204")).toBe(true);
    expect(matchesStatus(301, "200, 204")).toBe(false);
  });

  it("matches inclusive ranges (any order)", () => {
    expect(matchesStatus(250, "200-299")).toBe(true);
    expect(matchesStatus(299, "200-299")).toBe(true);
    expect(matchesStatus(300, "200-299")).toBe(false);
    expect(matchesStatus(250, "299-200")).toBe(true);
  });

  it("handles mixed lists of ranges and singles", () => {
    expect(matchesStatus(401, "200-299, 401")).toBe(true);
    expect(matchesStatus(404, "200-399")).toBe(false);
    expect(matchesStatus(204, "200-399")).toBe(true);
  });
});

describe("statusMessage", () => {
  it("reports nothing to check yet", () => {
    expect(statusMessage([], 0)).toBe("Checking services…");
  });
  it("reports all up", () => {
    expect(statusMessage([], 4)).toBe("All systems operational");
  });
  it("names the single down service", () => {
    expect(statusMessage(["Plex"], 4)).toBe("Plex is down");
  });
  it("collapses to 'Multiple services down' beyond one", () => {
    expect(statusMessage(["Plex", "Grafana"], 5)).toBe("Multiple services down");
  });
});

describe("formatBarLabel", () => {
  // 14:30 UTC is 09:30 in America/Chicago (CDT, UTC-5) on this date.
  it("renders a per-poll instant in the given time zone, not UTC", () => {
    expect(formatBarLabel("2026-06-25T14:30", "America/Chicago")).toBe(
      "Jun 25, 9:30 AM"
    );
    expect(formatBarLabel("2026-06-25T14:30", "UTC")).toBe("Jun 25, 2:30 PM");
  });

  it("renders an hourly bucket in the given time zone", () => {
    expect(formatBarLabel("2026-06-25T14", "America/Chicago")).toBe(
      "Jun 25, 9 AM"
    );
  });

  it("crosses the local day boundary correctly", () => {
    // 02:00 UTC is the previous evening (21:00) in Chicago.
    expect(formatBarLabel("2026-06-25T02:00", "America/Chicago")).toBe(
      "Jun 24, 9:00 PM"
    );
  });

  it("shows a daily bucket as its calendar date without shifting the zone", () => {
    expect(formatBarLabel("2026-06-25", "America/Chicago")).toBe("Jun 25");
  });

  it("falls back to UTC when the time zone is invalid", () => {
    expect(formatBarLabel("2026-06-25T14:30", "Not/AZone")).toBe(
      "Jun 25, 2:30 PM"
    );
  });
});

describe("formatSince", () => {
  // Jul 4 2026, 22:04 UTC — 5:04 PM in America/Chicago (CDT, UTC-5).
  const ms = Date.UTC(2026, 6, 4, 22, 4);

  it("shows month + day for the day-scale ranges", () => {
    expect(formatSince(ms, "UTC", "d90")).toBe("Jul 4");
    expect(formatSince(ms, "UTC", "d30")).toBe("Jul 4");
  });

  it("shows a clock time for the 1h range", () => {
    expect(formatSince(ms, "America/Chicago", "h1")).toBe("5:04 PM");
    expect(formatSince(ms, "UTC", "h1")).toBe("10:04 PM");
  });

  it("formats in the given zone, crossing the day boundary", () => {
    // 02:00 UTC on Jul 4 is the previous evening in Chicago.
    expect(formatSince(Date.UTC(2026, 6, 4, 2, 0), "America/Chicago", "d30")).toBe(
      "Jul 3"
    );
  });

  it("falls back to UTC when the time zone is invalid", () => {
    expect(formatSince(ms, "Not/AZone", "h1")).toBe("10:04 PM");
    expect(formatSince(ms, "Not/AZone", "d90")).toBe("Jul 4");
  });
});
