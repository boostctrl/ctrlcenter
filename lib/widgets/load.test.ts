import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { useScratchConfig } from "@/lib/testing/routes";
import { newInstance } from "@/lib/schema";

// What a board's data carries for its widgets: a visitor gets what each one
// shows, never the settings behind it — an API widget's request (#302), a
// calendar's address, feed URLs, disk paths (#380) — while the server-side
// fetches still use them.
let loadHomeData: typeof import("./load").loadHomeData;

// The system stats collector, recording the disk rows it's asked to measure.
const collectSystemStats = vi.hoisted(() =>
  vi.fn(async (disks: { label: string; path: string }[]) => ({
    source: "container" as const,
    cpu: null,
    memory: null,
    disks: disks.map((d) => ({ label: d.label, usedBytes: 1, totalBytes: 2 })),
  }))
);
vi.mock("@/lib/system-stats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/system-stats")>()),
  collectSystemStats,
}));

const api = {
  ...newInstance("api", "nas"),
  title: "NAS",
  url: "http://nas.lan/pool",
  headers: [{ name: "Authorization", value: "Bearer secret" }],
  fields: [{ label: "Used", path: "$.used", unit: "%" }],
  visibility: "public" as const,
};
// A Google "secret address in iCal format".
const CAL_URL = "https://calendar.google.test/calendar/ical/me/private-cal-token-1f2e/basic.ics";
const calendar = { ...newInstance("calendar", "cal"), url: CAL_URL };
const FEED_URL = "https://feeds.example.test/rss?key=feed-token-9c8b";
const feed = { ...newInstance("feed", "news"), title: "News", urls: [FEED_URL] };
const DISK_PATH = "/mnt/private-volume-7d6a";
const stats = { ...newInstance("systemStats", "stats"), title: "Server", disks: [{ label: "Media", path: DISK_PATH }] };
const SECRETS = [/nas\.lan/, /\$\.used/, /cal-token/, /feed-token/, /private-volume/];

const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:1",
  "SUMMARY:Standup",
  "DTSTART:20990101T120000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");
const RSS =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>Wire</title>' +
  "<item><title>Headline</title><link>https://news.example.test/a</link></item></channel></rss>";

beforeAll(async () => {
  await useScratchConfig();
  const config = await import("@/lib/config");
  await config.replaceWidgets([api, calendar, feed, stats]);
  ({ loadHomeData } = await import("./load"));
});

afterEach(() => vi.unstubAllGlobals());

async function load(isAdmin: boolean) {
  // What a board loads from: readPublicConfig's redacted config.
  const { stripSecrets, readConfigInternal } = await import("@/lib/config");
  const config = stripSecrets(await readConfigInternal());
  // The calendar and the feed answer only at their stored addresses.
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(CAL_URL)) return new Response(ICS);
    if (url === FEED_URL) return new Response(RSS, { headers: { "content-type": "application/rss+xml" } });
    return Response.json({ used: 42 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const data = await loadHomeData({
    settings: config.settings,
    instances: config.widgets,
    apps: [],
    bookmarks: [],
    groups: [],
    widgets: [
      { id: "nas", type: "api", span: 8, hidden: false },
      { id: "cal", type: "calendar", span: 8, hidden: false },
      { id: "news", type: "feed", span: 8, hidden: false },
      { id: "stats", type: "systemStats", span: 8, hidden: false },
    ],
    isAdmin,
    now: new Date(),
  });
  return { data, fetchMock };
}

const props = (node: unknown) => (isValidElement(node) ? (node as ReactElement<Record<string, unknown>>).props : {});

describe("loadHomeData: API widgets", () => {
  it("gives a visitor the view but not the URL, headers or paths", async () => {
    const { data, fetchMock } = await load(false);
    expect(data.apiViews.nas.view).toMatchObject({ value: "42", unit: "%" });
    // The fetch used the stored header, not the page's blanked one.
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) => String(u).includes("nas.lan"));
    expect(new Headers(call?.[1].headers).get("Authorization")).toBe("Bearer secret");
    expect(data.instances.nas).toEqual({ id: "nas", type: "api", title: "NAS" });
  });

  it("gives the admin the whole widget", async () => {
    const { data } = await load(true);
    expect(data.instances.nas).toMatchObject({ url: "http://nas.lan/pool" });
  });
});

describe("loadHomeData: what a visitor's page carries (#380)", () => {
  it("renders the calendar, feed and stats from the stored settings, and sends none of them", async () => {
    const { data } = await load(false);
    // The server fetched with the stored address, URLs and paths (the events
    // and headlines come only from those), so the widgets render...
    expect(collectSystemStats).toHaveBeenCalledWith([{ label: "Media", path: DISK_PATH }]);
    expect((props(data.nodes.cal).events as { summary: string }[])[0].summary).toBe("Standup");
    expect((props(data.nodes.news).feed as { items: { title: string }[] }).items[0].title).toBe("Headline");
    expect(data.systemStats.stats?.disks).toEqual([{ label: "Media", usedBytes: 1, totalBytes: 2 }]);

    // But each instance is only what its renderer reads.
    expect(data.instances).toEqual({
      nas: { id: "nas", type: "api", title: "NAS" },
      cal: { id: "cal", type: "calendar" },
      news: { id: "news", type: "feed" },
      stats: { id: "stats", type: "systemStats", title: "Server" },
    });
    // Nothing anywhere in the page's data names them.
    const sent = JSON.stringify(data);
    for (const secret of SECRETS) expect(sent).not.toMatch(secret);
  });

  it("gives the admin the instances whole", async () => {
    const { data } = await load(true);
    expect(data.instances.cal).toMatchObject({ url: CAL_URL, count: 5 });
    expect(data.instances.news).toMatchObject({ urls: [FEED_URL] });
    expect(data.instances.stats).toMatchObject({ disks: [{ label: "Media", path: DISK_PATH }] });
  });
});
