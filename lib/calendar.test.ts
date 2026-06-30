import { describe, it, expect } from "vitest";
import {
  parseICS,
  parseICalDate,
  parseRRule,
  expandRecurring,
  upcomingEvents,
  eventWhen,
  fetchCalendar,
} from "./calendar";

const DAY = 86_400_000;

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

describe("parseRRule", () => {
  it("parses a weekly rule with interval, byday, and count", () => {
    expect(parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10")).toEqual({
      freq: "WEEKLY",
      interval: 2,
      count: 10,
      byDay: [1, 3],
    });
  });

  it("parses UNTIL and defaults interval to 1", () => {
    const r = parseRRule("FREQ=DAILY;UNTIL=20260605T100000Z");
    expect(r?.freq).toBe("DAILY");
    expect(r?.interval).toBe(1);
    expect(r?.until).toBe(Date.parse("2026-06-05T10:00:00Z"));
  });

  it("returns null for an unsupported frequency", () => {
    expect(parseRRule("FREQ=HOURLY")).toBeNull();
  });
});

describe("expandRecurring", () => {
  it("expands a weekly UTC event 7 days apart and strips recurrence metadata", () => {
    const start = Date.parse("2026-06-01T13:00:00Z");
    const master = {
      summary: "Standup",
      start,
      end: start + 15 * 60_000,
      allDay: false,
      rrule: { freq: "WEEKLY" as const, interval: 1 },
      uid: "a@x",
    };
    const now = Date.parse("2026-06-30T00:00:00Z");
    const out = expandRecurring([master], now, now + 28 * DAY);
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < out.length; i++)
      expect(out[i].start - out[i - 1].start).toBe(7 * DAY);
    expect(out.every((e) => e.start > now)).toBe(true);
    expect(out[0].end! - out[0].start).toBe(15 * 60_000);
    expect("rrule" in out[0]).toBe(false);
    expect("uid" in out[0]).toBe(false);
  });

  it("honors weekly BYDAY across weeks", () => {
    const start = Date.parse("2026-06-01T09:00:00Z");
    const startDow = new Date(start).getUTCDay();
    const otherDow = (startDow + 2) % 7;
    const master = {
      summary: "x",
      start,
      allDay: false,
      rrule: { freq: "WEEKLY" as const, interval: 1, byDay: [startDow, otherDow] },
      uid: "b",
    };
    const out = expandRecurring([master], start - DAY, start + 21 * DAY);
    expect(new Set(out.map((e) => new Date(e.start).getUTCDay()))).toEqual(
      new Set([startDow, otherDow])
    );
  });

  it("stops after COUNT occurrences", () => {
    const start = Date.parse("2026-06-01T10:00:00Z");
    const master = {
      summary: "x",
      start,
      allDay: false,
      rrule: { freq: "DAILY" as const, interval: 1, count: 3 },
      uid: "c",
    };
    const out = expandRecurring([master], start - DAY, start + 365 * DAY);
    expect(out.map((e) => e.start)).toEqual([start, start + DAY, start + 2 * DAY]);
  });

  it("expands a monthly event keeping the day of month", () => {
    const start = Date.parse("2026-01-15T12:00:00Z");
    const master = {
      summary: "x",
      start,
      allDay: false,
      rrule: { freq: "MONTHLY" as const, interval: 1 },
      uid: "m",
    };
    const now = Date.parse("2026-06-30T00:00:00Z");
    const out = expandRecurring([master], now, now + 90 * DAY);
    expect(out.length).toBeGreaterThanOrEqual(2);
    for (const e of out) expect(new Date(e.start).getUTCDate()).toBe(15);
  });

  it("keeps a weekly event at the same local time across a DST change", () => {
    // US DST springs forward 2026-03-08. A 09:00 New York weekly event should
    // read 09:00 local both before and after — at different UTC instants.
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:dst",
      "SUMMARY:Standup",
      "DTSTART;TZID=America/New_York:20260302T090000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const now = Date.parse("2026-03-01T00:00:00Z");
    const out = expandRecurring(parseICS(ics), now, now + 40 * DAY).sort(
      (a, b) => a.start - b.start
    );
    const localTime = (ms: number) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(ms));
    expect(out).toHaveLength(4); // Mar 2, 9, 16, 23
    for (const e of out) expect(localTime(e.start)).toBe("09:00");
    // EST(-05) → EDT(-04) across Mar 8, so consecutive instants aren't 7d apart.
    expect(out[1].start - out[0].start).not.toBe(7 * DAY);
  });

  it("skips months without the start day for a monthly series", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:m31",
      "SUMMARY:Rent",
      "DTSTART:20260131T100000Z",
      "RRULE:FREQ=MONTHLY;COUNT=4",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const now = Date.parse("2026-01-01T00:00:00Z");
    const out = expandRecurring(parseICS(ics), now, now + 220 * DAY).sort(
      (a, b) => a.start - b.start
    );
    // Feb/Apr/Jun have no 31st and are skipped without consuming COUNT.
    expect(out.map((e) => new Date(e.start).toISOString())).toEqual([
      "2026-01-31T10:00:00.000Z",
      "2026-03-31T10:00:00.000Z",
      "2026-05-31T10:00:00.000Z",
      "2026-07-31T10:00:00.000Z",
    ]);
  });

  it("skips EXDATE cancellations and applies RECURRENCE-ID overrides", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:s@x",
      "SUMMARY:Weekly",
      "DTSTART:20260601T150000Z",
      "DTEND:20260601T153000Z",
      "RRULE:FREQ=WEEKLY;COUNT=6",
      "EXDATE:20260615T150000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:s@x",
      "RECURRENCE-ID:20260608T150000Z",
      "SUMMARY:Weekly (moved)",
      "DTSTART:20260608T170000Z",
      "DTEND:20260608T173000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const now = Date.parse("2026-05-31T00:00:00Z");
    const out = expandRecurring(parseICS(ics), now, now + 60 * DAY).sort(
      (a, b) => a.start - b.start
    );
    const iso = out.map((e) => new Date(e.start).toISOString());
    // Series Jun1,8,15,22,29,Jul6: Jun15 cancelled, Jun8 moved to 17:00.
    expect(iso).toContain("2026-06-01T15:00:00.000Z");
    expect(iso).not.toContain("2026-06-15T15:00:00.000Z");
    expect(iso).not.toContain("2026-06-08T15:00:00.000Z");
    expect(iso).toContain("2026-06-08T17:00:00.000Z");
    expect(
      out.find((e) => e.start === Date.parse("2026-06-08T17:00:00Z"))?.summary
    ).toBe("Weekly (moved)");
    expect(out).toHaveLength(5);
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

  it("expands recurring events relative to now", async () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:d",
      "SUMMARY:Daily standup",
      "DTSTART:20200101T080000Z", // years ago — only future occurrences should show
      "RRULE:FREQ=DAILY",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(ics, { status: 200 })) as typeof fetch;
    try {
      const t0 = Date.now();
      const out = await fetchCalendar(`https://cal.example.test/${t0}-rrule.ics`, 3);
      expect(out).toHaveLength(3);
      expect(out.every((e) => e.summary === "Daily standup")).toBe(true);
      expect(out.every((e) => e.start > t0)).toBe(true);
      expect(out[1].start - out[0].start).toBe(DAY);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("fetchCalendar auth + WebDAV", () => {
  it("sends Basic auth and falls back to ?export for a DAV collection URL", async () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:dav",
      "SUMMARY:DAV event",
      "DTSTART:20990101T120000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const calls: { url: string; auth?: string }[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: u, auth: headers.Authorization });
      // The bare collection URL serves a WebDAV listing (not ICS); ?export does.
      return u.includes("export")
        ? new Response(ics, { status: 200 })
        : new Response("<d:multistatus xmlns:d='DAV:'/>", { status: 200 });
    }) as typeof fetch;
    try {
      const url = `https://cloud.example.test/remote.php/dav/calendars/me/cal-${Date.now()}/`;
      const out = await fetchCalendar(url, 5, {
        username: "me",
        password: "secret",
      });
      expect(out[0]?.summary).toBe("DAV event");
      expect(calls).toHaveLength(2); // bare URL, then ?export
      expect(calls[1].url).toContain("?export");
      const expected = "Basic " + Buffer.from("me:secret").toString("base64");
      expect(calls.every((c) => c.auth === expected)).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("does not append ?export when the URL already returns ICS, and omits auth when no username", async () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:p",
      "SUMMARY:Public",
      "DTSTART:20990101T120000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const calls: { url: string; auth?: string }[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), auth: headers.Authorization });
      return new Response(ics, { status: 200 });
    }) as typeof fetch;
    try {
      const url = `https://cal.example.test/${Date.now()}-public.ics`;
      const out = await fetchCalendar(url, 5);
      expect(out[0]?.summary).toBe("Public");
      expect(calls).toHaveLength(1);
      expect(calls[0].url).not.toContain("export");
      expect(calls[0].auth).toBeUndefined();
    } finally {
      globalThis.fetch = orig;
    }
  });
});
