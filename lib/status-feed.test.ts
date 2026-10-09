import { describe, it, expect } from "vitest";
import { buildStatusFeed, duration, MAX_FEED_ENTRIES, type FeedInput } from "./status-feed";

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 9, 12, 0);
const app = { id: "nas", name: "NAS" };
const base: FeedInput = {
  title: "Home",
  origin: "https://home.test",
  now: NOW,
  outages: [],
  announcements: [],
  announcementsUpdated: NOW - 60 * MIN,
};
const entries = (xml: string) => xml.split("<entry>").slice(1);

describe("buildStatusFeed (#295)", () => {
  it("lists a completed outage with its note, and an ongoing one", () => {
    const xml = buildStatusFeed({
      ...base,
      outages: [
        {
          app,
          outage: {
            startMs: NOW - 120 * MIN,
            endMs: NOW - 108 * MIN,
            downMs: 12 * MIN,
            exact: true,
            recorded: true,
            note: "Disk <swap> & reboot",
          },
        },
        { app, outage: { startMs: NOW - 5 * MIN, endMs: null, downMs: 5 * MIN, exact: true } },
      ],
    });
    const [ongoing, done] = entries(xml);
    expect(ongoing).toContain("<title>NAS is down</title>");
    expect(done).toContain("<title>NAS was down for 12m</title>");
    expect(done).toContain("Note: Disk &lt;swap&gt; &amp; reboot");
    expect(done).toContain(`<id>urn:ctrlcenter:outage:nas:${NOW - 120 * MIN}</id>`);
    expect(done).toContain('<link href="https://home.test/status/nas"/>');
    expect(xml).toContain('<link rel="self" href="https://home.test/status/feed.xml"/>');
    expect(xml).toContain(`<updated>${new Date(NOW - 5 * MIN).toISOString()}</updated>`);
  });

  it("dates an announcement by its window, else by the config's last change", () => {
    const xml = buildStatusFeed({
      ...base,
      announcements: [
        {
          id: "a1",
          kind: "maintenance",
          title: "NAS upgrade",
          body: "Swapping disks.",
          startsAt: new Date(NOW + 60 * MIN).toISOString(),
          endsAt: new Date(NOW + 120 * MIN).toISOString(),
          apps: [],
        },
        { id: "a2", kind: "info", title: "", body: "Hi", startsAt: "", endsAt: "", apps: [] },
      ],
    });
    const [scheduled, undated] = entries(xml);
    expect(scheduled).toContain("<title>Maintenance: NAS upgrade</title>");
    expect(scheduled).toContain("From Oct 9, 2026, 1:00 PM UTC to Oct 9, 2026, 2:00 PM UTC.");
    expect(undated).toContain("<title>Notice: (untitled)</title>");
    expect(undated).toContain(`<updated>${new Date(NOW - 60 * MIN).toISOString()}</updated>`);
  });

  it("keeps the newest entries", () => {
    const outages = Array.from({ length: MAX_FEED_ENTRIES + 5 }, (_, i) => ({
      app,
      outage: { startMs: NOW - (i + 2) * 60 * MIN, endMs: NOW - (i + 1) * 60 * MIN, downMs: 60 * MIN, exact: true },
    }));
    expect(entries(buildStatusFeed({ ...base, outages }))).toHaveLength(MAX_FEED_ENTRIES);
  });

  it("formats durations compactly", () => {
    expect(duration(30_000)).toBe("1m");
    expect(duration(90 * MIN)).toBe("1h 30m");
    expect(duration(48 * 60 * MIN)).toBe("2d");
  });
});
