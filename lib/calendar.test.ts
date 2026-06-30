import { describe, it, expect } from "vitest";
import {
  parseICS,
  parseICalDate,
  upcomingEvents,
  eventWhen,
  fetchCalendar,
} from "./calendar";

describe("parseICalDate", () => {
  it("parses a UTC date-time", () => {
    expect(parseICalDate("20260630T120000Z", {})).toEqual({
      ms: Date.parse("2026-06-30T12:00:00Z"),
      allDay: false,
    });
  });

  it("parses an all-day DATE value", () => {
    expect(parseICalDate("20260630", { VALUE: "DATE" })).toEqual({
      ms: Date.UTC(2026, 5, 30),
      allDay: true,
    });
    // Bare 8-digit value is treated as all-day too.
    expect(parseICalDate("20260630", {})?.allDay).toBe(true);
  });

  it("resolves a TZID wall-clock time to the right instant", () => {
    // 12:00 in New York (EDT, -04:00) on 2026-06-30 == 16:00 UTC.
    const hit = parseICalDate("20260630T120000", { TZID: "America/New_York" });
    expect(hit).toEqual({
      ms: Date.parse("2026-06-30T16:00:00Z"),
      allDay: false,
    });
  });

  it("returns null for junk", () => {
    expect(parseICalDate("not-a-date", {})).toBeNull();
  });
});

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:1@x",
  "SUMMARY:Team sync\\, weekly",
  "DTSTART:20260630T120000Z",
  "DTEND:20260630T130000Z",
  "LOCATION:Room A",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:2@x",
  "SUMMARY:All-day off-site with a very long title that is folded ",
  " across two lines",
  "DTSTART;VALUE=DATE:20260701",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseICS", () => {
  it("reads events, unescapes text, and unfolds wrapped lines", () => {
    const events = parseICS(ICS);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      summary: "Team sync, weekly",
      start: Date.parse("2026-06-30T12:00:00Z"),
      end: Date.parse("2026-06-30T13:00:00Z"),
      allDay: false,
      location: "Room A",
    });
    expect(events[1].allDay).toBe(true);
    expect(events[1].summary).toBe(
      "All-day off-site with a very long title that is folded across two lines"
    );
  });

  it("skips events missing a summary or start", () => {
    const ics = [
      "BEGIN:VEVENT",
      "DTSTART:20260630T120000Z",
      "END:VEVENT", // no SUMMARY
    ].join("\r\n");
    expect(parseICS(ics)).toHaveLength(0);
  });
});

describe("upcomingEvents", () => {
  const now = Date.parse("2026-06-30T12:00:00Z");
  const ev = (summary: string, startISO: string, allDay = false) => ({
    summary,
    start: Date.parse(startISO),
    allDay,
  });

  it("drops finished events, sorts by start, and limits the count", () => {
    const events = [
      ev("past", "2026-06-29T10:00:00Z"),
      ev("soon", "2026-06-30T15:00:00Z"),
      ev("later", "2026-07-02T09:00:00Z"),
    ];
    const out = upcomingEvents(events, now, 1);
    expect(out.map((e) => e.summary)).toEqual(["soon"]);
    expect(upcomingEvents(events, now, 5).map((e) => e.summary)).toEqual([
      "soon",
      "later",
    ]);
  });

  it("keeps an all-day event until the end of its day", () => {
    // Started at UTC midnight today; still counts as upcoming at noon.
    const today = [ev("today", "2026-06-30T00:00:00Z", true)];
    expect(upcomingEvents(today, now, 5)).toHaveLength(1);
  });
});

describe("eventWhen", () => {
  const tz = "America/Chicago"; // behind UTC, where the all-day bug showed up

  it("renders an all-day event on its literal date, not shifted by the viewer zone", () => {
    // All-day July 1 is anchored at UTC midnight; in Chicago that instant is
    // June 30 evening, so the old code mislabeled it "Jun 30".
    const event = { summary: "x", start: Date.UTC(2026, 6, 1), allDay: true };
    const now = Date.parse("2026-06-29T12:00:00Z");
    const { day, time } = eventWhen(event, tz, now);
    expect(day).toContain("Jul 1");
    expect(day).not.toContain("Jun");
    expect(time).toBe("All day");
  });

  it("labels an all-day event Today relative to the viewer's day", () => {
    const event = { summary: "x", start: Date.UTC(2026, 6, 1), allDay: true };
    // Viewer is on 2026-07-01 in Chicago (10:00 local = 15:00Z).
    expect(eventWhen(event, tz, Date.parse("2026-07-01T15:00:00Z")).day).toBe("Today");
  });

  it("formats a timed event's time in the site zone", () => {
    const event = {
      summary: "x",
      start: Date.parse("2026-06-30T17:00:00Z"), // 12:00 CDT
      allDay: false,
    };
    const { day, time } = eventWhen(event, tz, Date.parse("2026-06-30T12:00:00Z"));
    expect(day).toBe("Today");
    expect(time).toBe("12:00 PM");
  });
});

describe("fetchCalendar caching", () => {
  it("parses once and serves the cache without re-fetching within the TTL", async () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:1",
      "SUMMARY:Far future",
      "DTSTART:20990101T120000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    let calls = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(ics, { status: 200 });
    }) as typeof fetch;
    try {
      const url = `https://cal.example.test/${Date.now()}.ics`; // unique → no stale cache
      const a = await fetchCalendar(url, 5);
      const b = await fetchCalendar(url, 5);
      expect(calls).toBe(1);
      expect(a).toEqual(b);
      expect(a[0]?.summary).toBe("Far future");
    } finally {
      globalThis.fetch = orig;
    }
  });
});
