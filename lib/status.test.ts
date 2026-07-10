import { describe, it, expect } from "vitest";
import {
  summarize,
  matchesStatus,
  statusMessage,
  formatBarLabel,
  timelineSummary,
  formatSince,
  type BarPoint,
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

  it("labels a sub-day bucket's range when given its span", () => {
    // 48-minute bucket (the 24h view): the shared date and AM/PM collapse.
    expect(
      formatBarLabel("2026-07-07T17:54", "UTC", 48 * 60 * 1000)
    ).toBe("Jul 7, 5:54 – 6:42 PM");
    // 2-minute bucket (the 1h view).
    expect(
      formatBarLabel("2026-06-25T14:30", "UTC", 2 * 60 * 1000)
    ).toBe("Jun 25, 2:30 – 2:32 PM");
  });

  it("expands a bucket range across a day boundary", () => {
    expect(
      formatBarLabel("2026-07-07T23:50", "UTC", 30 * 60 * 1000)
    ).toBe("Jul 7, 11:50 PM – Jul 8, 12:20 AM");
  });

  it("ignores the span for a day-scale bucket (stays a single date)", () => {
    expect(
      formatBarLabel("2026-06-25", "America/Chicago", 3 * 24 * 60 * 60 * 1000)
    ).toBe("Jun 25");
  });

  it("falls back to UTC for a range label when the time zone is invalid", () => {
    expect(
      formatBarLabel("2026-06-25T14:30", "Not/AZone", 2 * 60 * 1000)
    ).toBe("Jun 25, 2:30 – 2:32 PM");
  });
});

describe("timelineSummary", () => {
  const bar = (at: string, uptime: number | null, ms: number | null = null): BarPoint => ({
    at,
    uptime,
    ms,
  });

  it("summarizes average uptime and calls out the worst bucket by its range", () => {
    // Two 48-minute (24h view) buckets: 100% and 0%; the 0% one is the worst and
    // reads as the range it spans.
    const points = [bar("2026-07-07T17:06", 100), bar("2026-07-07T17:54", 0)];
    expect(timelineSummary(points, "UTC", "d1")).toBe(
      "24h uptime timeline: 50.0% up, worst Jul 7, 5:54 – 6:42 PM at 0.0% up"
    );
  });

  it("averages only the buckets that carry data, ignoring no-data gaps", () => {
    const points = [bar("2026-07-07T17:06", 100), bar("2026-07-07T17:54", null)];
    expect(timelineSummary(points, "UTC", "d1")).toBe(
      "24h uptime timeline: 100.0% up, worst Jul 7, 5:06 – 5:54 PM at 100.0% up"
    );
  });

  it("describes an all-empty strip without a fabricated 0%", () => {
    const points = [bar("2026-07-07T17:06", null), bar("2026-07-07T17:54", null)];
    expect(timelineSummary(points, "UTC", "d1")).toBe(
      "24h uptime timeline: no data yet"
    );
  });

  it("quotes the displayed windowed % over the bucket mean when given", () => {
    // Bucket mean would say 50.0%; the row's windowed figure (weighted by real
    // sample counts) says 90.5% — the spoken summary must match the visible one.
    const points = [bar("2026-07-07T17:06", 100), bar("2026-07-07T17:54", 0)];
    expect(timelineSummary(points, "UTC", "d1", 90.5)).toBe(
      "24h uptime timeline: 90.5% up, worst Jul 7, 5:54 – 6:42 PM at 0.0% up"
    );
    // A null windowed % (no data for the range) falls back to the bucket mean.
    expect(timelineSummary(points, "UTC", "d1", null)).toBe(
      "24h uptime timeline: 50.0% up, worst Jul 7, 5:54 – 6:42 PM at 0.0% up"
    );
  });

  it("describes history only — no live 'currently' clause (#141)", () => {
    // The strip is history; live state is the row's detail line's job.
    const points = [bar("2026-07-07T17:06", 100)];
    expect(timelineSummary(points, "UTC", "d1")).toBe(
      "24h uptime timeline: 100.0% up, worst Jul 7, 5:06 – 5:54 PM at 100.0% up"
    );
    expect(timelineSummary([], "UTC", "d1")).toBe("24h uptime timeline: no data yet");
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
