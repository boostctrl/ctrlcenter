import { describe, it, expect } from "vitest";
import {
  announcementState,
  visibleAnnouncements,
  announcementWindowLabel,
} from "./status-announcements";
import type { StatusAnnouncement } from "./schema";

// A fixed "now" for the timing tests: Jul 11 2026, 12:00 UTC.
const NOW = Date.UTC(2026, 6, 11, 12, 0);

function entry(overrides: Partial<StatusAnnouncement> = {}): StatusAnnouncement {
  return {
    id: "a",
    title: "",
    body: "",
    kind: "info",
    startsAt: "",
    endsAt: "",
    ...overrides,
  };
}

describe("announcementState", () => {
  it("is active when both bounds are unset", () => {
    expect(announcementState(entry(), NOW)).toBe("active");
  });

  it("is scheduled when the start is in the future", () => {
    expect(
      announcementState(entry({ startsAt: "2026-07-11T18:00:00.000Z" }), NOW)
    ).toBe("scheduled");
  });

  it("is active once the start has passed and there is no end", () => {
    expect(
      announcementState(entry({ startsAt: "2026-07-11T06:00:00.000Z" }), NOW)
    ).toBe("active");
  });

  it("is active inside a start–end window", () => {
    expect(
      announcementState(
        entry({
          startsAt: "2026-07-11T10:00:00.000Z",
          endsAt: "2026-07-11T14:00:00.000Z",
        }),
        NOW
      )
    ).toBe("active");
  });

  it("is expired once the end has passed", () => {
    expect(
      announcementState(entry({ endsAt: "2026-07-11T06:00:00.000Z" }), NOW)
    ).toBe("expired");
  });

  it("treats the end instant itself as expired (inclusive)", () => {
    expect(
      announcementState(entry({ endsAt: new Date(NOW).toISOString() }), NOW)
    ).toBe("expired");
  });

  it("treats a future end past its own start as expired (end wins)", () => {
    // A misconfigured window whose end has already passed reads as over even if
    // the start was set later still.
    expect(
      announcementState(
        entry({
          startsAt: "2026-07-11T20:00:00.000Z",
          endsAt: "2026-07-11T06:00:00.000Z",
        }),
        NOW
      )
    ).toBe("expired");
  });

  it("ignores an unparsable date (treated as unset → active)", () => {
    expect(
      announcementState(entry({ startsAt: "not a date", endsAt: "junk" }), NOW)
    ).toBe("active");
  });

  it("ignores an unparsable end so a good future start still schedules", () => {
    expect(
      announcementState(
        entry({ startsAt: "2026-07-11T18:00:00.000Z", endsAt: "nope" }),
        NOW
      )
    ).toBe("scheduled");
  });
});

describe("visibleAnnouncements", () => {
  it("drops expired entries", () => {
    const list = [
      entry({ id: "gone", endsAt: "2026-07-11T06:00:00.000Z" }),
      entry({ id: "here" }),
    ];
    const visible = visibleAnnouncements(list, NOW);
    expect(visible.map((v) => v.announcement.id)).toEqual(["here"]);
    expect(visible[0].state).toBe("active");
  });

  it("orders active before scheduled", () => {
    const list = [
      entry({ id: "sched", startsAt: "2026-07-11T18:00:00.000Z" }),
      entry({ id: "act" }),
    ];
    expect(
      visibleAnnouncements(list, NOW).map((v) => v.announcement.id)
    ).toEqual(["act", "sched"]);
  });

  it("orders active by soonest end, windowless last", () => {
    const list = [
      entry({ id: "windowless" }),
      entry({ id: "late", endsAt: "2026-07-11T20:00:00.000Z" }),
      entry({ id: "soon", endsAt: "2026-07-11T14:00:00.000Z" }),
    ];
    expect(
      visibleAnnouncements(list, NOW).map((v) => v.announcement.id)
    ).toEqual(["soon", "late", "windowless"]);
  });

  it("orders scheduled by soonest start", () => {
    const list = [
      entry({ id: "later", startsAt: "2026-07-12T10:00:00.000Z" }),
      entry({ id: "sooner", startsAt: "2026-07-11T18:00:00.000Z" }),
    ];
    expect(
      visibleAnnouncements(list, NOW).map((v) => v.announcement.id)
    ).toEqual(["sooner", "later"]);
  });
});

describe("announcementWindowLabel", () => {
  it("formats a scheduled start–end range in the given zone", () => {
    // 13:00–15:00 UTC is 8:00–10:00 AM in America/Chicago (CDT, UTC-5).
    expect(
      announcementWindowLabel(
        {
          startsAt: "2026-07-11T13:00:00.000Z",
          endsAt: "2026-07-11T15:00:00.000Z",
        },
        "scheduled",
        "America/Chicago"
      )
    ).toBe("Sat, Jul 11, 8:00 – 10:00 AM");
  });

  it("expands a scheduled window across a day boundary", () => {
    expect(
      announcementWindowLabel(
        {
          startsAt: "2026-07-11T23:00:00.000Z",
          endsAt: "2026-07-12T01:00:00.000Z",
        },
        "scheduled",
        "UTC"
      )
    ).toBe("Sat, Jul 11, 11:00 PM – Sun, Jul 12, 1:00 AM");
  });

  it("labels a scheduled start with no end", () => {
    expect(
      announcementWindowLabel(
        { startsAt: "2026-07-11T13:00:00.000Z", endsAt: "" },
        "scheduled",
        "America/Chicago"
      )
    ).toBe("Starts Sat, Jul 11, 8:00 AM");
  });

  it("labels an active entry's end as 'Until'", () => {
    expect(
      announcementWindowLabel(
        { startsAt: "", endsAt: "2026-07-11T15:00:00.000Z" },
        "active",
        "America/Chicago"
      )
    ).toBe("Until Sat, Jul 11, 10:00 AM");
  });

  it("returns empty for an active windowless entry", () => {
    expect(
      announcementWindowLabel({ startsAt: "", endsAt: "" }, "active", "UTC")
    ).toBe("");
  });

  it("falls back to UTC when the time zone is invalid", () => {
    expect(
      announcementWindowLabel(
        {
          startsAt: "2026-07-11T13:00:00.000Z",
          endsAt: "2026-07-11T15:00:00.000Z",
        },
        "scheduled",
        "Not/AZone"
      )
    ).toBe("Sat, Jul 11, 1:00 – 3:00 PM");
  });
});
