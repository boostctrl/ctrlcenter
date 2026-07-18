import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchFeeds,
  getFeedHealth,
  mergeFeeds,
  parseFeed,
  parseJsonFeed,
  type Feed,
} from "./feed";

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Homelab Blog</title>
    <link>https://blog.example.com</link>
    <item>
      <title>Backups &amp; snapshots</title>
      <link>https://blog.example.com/backups</link>
      <pubDate>Tue, 30 Jun 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title><![CDATA[ZFS <tips> for 2026]]></title>
      <link>https://blog.example.com/zfs</link>
      <pubDate>not a date</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Release notes</title>
  <link href="https://releases.example.com/" rel="alternate"/>
  <entry>
    <title>v2.0 released</title>
    <link rel="enclosure" href="https://releases.example.com/v2.tar.gz"/>
    <link rel="alternate" href="https://releases.example.com/v2"/>
    <published>2026-06-28T08:30:00Z</published>
  </entry>
  <entry>
    <title>v1.9 released</title>
    <link href="https://releases.example.com/v1.9"/>
    <updated>2026-06-01T08:30:00Z</updated>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("parses RSS 2.0 titles, links and dates", () => {
    const feed = parseFeed(RSS);
    expect(feed.title).toBe("Homelab Blog");
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]).toEqual({
      title: "Backups & snapshots",
      url: "https://blog.example.com/backups",
      publishedAt: Date.parse("Tue, 30 Jun 2026 10:00:00 GMT"),
    });
  });

  it("unwraps CDATA, strips tags and nulls an unparsable date", () => {
    const item = parseFeed(RSS).items[1];
    expect(item.title).toBe("ZFS for 2026");
    expect(item.publishedAt).toBeNull();
  });

  it("parses Atom entries, preferring the alternate link", () => {
    const feed = parseFeed(ATOM);
    expect(feed.title).toBe("Release notes");
    expect(feed.items[0]).toEqual({
      title: "v2.0 released",
      url: "https://releases.example.com/v2",
      publishedAt: Date.parse("2026-06-28T08:30:00Z"),
    });
    expect(feed.items[1].url).toBe("https://releases.example.com/v1.9");
    expect(feed.items[1].publishedAt).toBe(Date.parse("2026-06-01T08:30:00Z"));
  });

  it("takes the feed title from before the first entry, not an item's", () => {
    // No channel title: the first <title> in the doc belongs to an item.
    const feed = parseFeed(
      "<rss><channel><item><title>Only item</title></item></channel></rss>"
    );
    expect(feed.title).toBe("");
    expect(feed.items[0].title).toBe("Only item");
  });

  it("drops non-http(s) links but keeps the entry", () => {
    const feed = parseFeed(
      `<rss><channel><title>t</title><item><title>x</title><link>javascript:alert(1)</link></item></channel></rss>`
    );
    expect(feed.items[0].url).toBe("");
  });

  it("skips entries without a title", () => {
    const feed = parseFeed(
      `<rss><channel><title>t</title><item><link>https://a.example</link></item><item><title>ok</title></item></channel></rss>`
    );
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].title).toBe("ok");
  });

  it("decodes numeric and named entities without double-decoding", () => {
    const feed = parseFeed(
      `<rss><channel><title>t</title><item><title>A &#x26; B &amp;#38; C</title></item></channel></rss>`
    );
    expect(feed.items[0].title).toBe("A & B &#38; C");
  });

  it("returns an empty feed for non-feed input", () => {
    expect(parseFeed("<html><body>nope</body></html>")).toEqual({
      title: "",
      items: [],
    });
  });
});

describe("summaries", () => {
  const rss = (item: string) =>
    `<rss><channel><title>t</title><item><title>Headline</title>${item}</item></channel></rss>`;

  it("extracts an RSS description as clipped plain text", () => {
    const feed = parseFeed(
      rss("<description><![CDATA[<p>Some <b>bold</b> body &amp; more</p>]]></description>")
    );
    expect(feed.items[0].summary).toBe("Some bold body & more");
  });

  it("prefers an Atom summary and falls back to content", () => {
    const entry = (body: string) =>
      `<feed><title>t</title><entry><title>Headline</title>${body}</entry></feed>`;
    expect(
      parseFeed(entry("<summary>short</summary><content>long body</content>"))
        .items[0].summary
    ).toBe("short");
    expect(
      parseFeed(entry('<content type="xhtml"><div>the body</div></content>'))
        .items[0].summary
    ).toBe("the body");
  });

  it("omits the summary when the entry has no body or it repeats the title", () => {
    expect(parseFeed(rss("")).items[0].summary).toBeUndefined();
    expect(
      parseFeed(rss("<description>Headline</description>")).items[0].summary
    ).toBeUndefined();
  });

  it("clips a long body to the budget on a word boundary with an ellipsis", () => {
    const body = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const summary = parseFeed(rss(`<description>${body}</description>`)).items[0]
      .summary!;
    expect(summary.length).toBeLessThanOrEqual(201);
    expect(summary.endsWith("…")).toBe(true);
    // Word-boundary cut: no partial word before the ellipsis.
    expect(body.startsWith(summary.slice(0, -1) + " ")).toBe(true);
  });

  it("maps JSON Feed summary, content_text, and stripped content_html", () => {
    const jf = (item: object) =>
      parseJsonFeed(
        JSON.stringify({
          version: "https://jsonfeed.org/version/1.1",
          title: "t",
          items: [{ title: "Headline", ...item }],
        })
      )?.items[0].summary;
    expect(jf({ summary: "the summary", content_text: "the text" })).toBe(
      "the summary"
    );
    expect(jf({ content_text: "the text" })).toBe("the text");
    expect(jf({ content_html: "<p>html <em>body</em></p>" })).toBe("html body");
  });
});

describe("parseJsonFeed", () => {
  const JSON_FEED = JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title: "JSON Blog",
    items: [
      {
        title: "  Spaced   title  ",
        url: "https://json.example.com/one",
        date_published: "2026-06-30T10:00:00Z",
      },
      { title: "No link or date" },
      { title: "Bad link", url: "javascript:alert(1)" },
      { url: "https://json.example.com/untitled" },
    ],
  });

  it("maps title, url and date_published into the FeedItem shape", () => {
    const feed = parseJsonFeed(JSON_FEED);
    expect(feed?.title).toBe("JSON Blog");
    expect(feed?.items[0]).toEqual({
      title: "Spaced title",
      url: "https://json.example.com/one",
      publishedAt: Date.parse("2026-06-30T10:00:00Z"),
    });
  });

  it("keeps entries without a link or date, drops non-http(s) links and untitled entries", () => {
    const items = parseJsonFeed(JSON_FEED)?.items ?? [];
    expect(items).toHaveLength(3);
    expect(items[1]).toEqual({ title: "No link or date", url: "", publishedAt: null });
    expect(items[2].url).toBe("");
  });

  it("does not decode entities — JSON Feed titles are already plain text", () => {
    const feed = parseJsonFeed(
      JSON.stringify({
        version: "https://jsonfeed.org/version/1",
        title: "t",
        items: [{ title: "AT&amp;T wrote this literally" }],
      })
    );
    expect(feed?.items[0].title).toBe("AT&amp;T wrote this literally");
  });

  it("rejects JSON without the jsonfeed.org version marker", () => {
    expect(parseJsonFeed(JSON.stringify({ title: "t", items: [] }))).toBeNull();
    expect(
      parseJsonFeed(JSON.stringify({ version: "2.0", items: [] }))
    ).toBeNull();
  });

  it("rejects non-JSON and non-object bodies", () => {
    expect(parseJsonFeed("<rss></rss>")).toBeNull();
    expect(parseJsonFeed("not json {")).toBeNull();
    expect(parseJsonFeed('"a string"')).toBeNull();
  });
});

describe("mergeFeeds", () => {
  const dated = (title: string, ms: number) => ({
    title,
    url: `https://x/${title}`,
    publishedAt: ms,
  });
  const undated = (title: string) => ({
    title,
    url: `https://x/${title}`,
    publishedAt: null,
  });
  const feed = (title: string, items: Feed["items"]): Feed => ({ title, items });
  const src = (f: Feed) => ({ feed: f, source: f.title });

  it("interleaves dated items newest-first and stamps each source", () => {
    const a = feed("Blog A", [dated("a2", 200), dated("a1", 100)]);
    const b = feed("Blog B", [dated("b3", 300), dated("b1", 150)]);
    const merged = mergeFeeds([src(a), src(b)], 10);
    expect(merged.items.map((i) => i.title)).toEqual(["b3", "a2", "b1", "a1"]);
    expect(merged.items.map((i) => i.source)).toEqual([
      "Blog B",
      "Blog A",
      "Blog B",
      "Blog A",
    ]);
    // Title falls back to the first feed's own title.
    expect(merged.title).toBe("Blog A");
  });

  it("does not label items when only one feed contributes", () => {
    const merged = mergeFeeds([src(feed("Solo", [dated("x", 1)]))], 10);
    expect(merged.items[0].source).toBeUndefined();
  });

  it("keeps an undated item beside its feed's neighbours, not at the end", () => {
    // Feed A runs newest-first: dated 300, an undated item (inherits 300), then
    // dated 100. Feed B has one item at 200. The undated item must land right
    // after its dated predecessor, above B's 200 — never dumped last.
    const a = feed("A", [dated("a-new", 300), undated("a-mid"), dated("a-old", 100)]);
    const b = feed("B", [dated("b", 200)]);
    const merged = mergeFeeds([src(a), src(b)], 10);
    expect(merged.items.map((i) => i.title)).toEqual([
      "a-new",
      "a-mid",
      "b",
      "a-old",
    ]);
  });

  it("caps the merged list at count", () => {
    const a = feed("A", [dated("a3", 300), dated("a1", 100)]);
    const b = feed("B", [dated("b2", 200)]);
    const merged = mergeFeeds([src(a), src(b)], 2);
    expect(merged.items.map((i) => i.title)).toEqual(["a3", "b2"]);
  });

  it("dedupes items sharing a URL, keeping the highest-ranked occurrence", () => {
    const story = (title: string, ms: number) => ({
      title,
      url: "https://x/shared-story",
      publishedAt: ms,
    });
    const a = feed("A", [story("via A", 300), dated("a1", 100)]);
    const b = feed("B", [story("via B", 200), dated("b1", 150)]);
    const merged = mergeFeeds([src(a), src(b)], 10);
    expect(merged.items.map((i) => i.title)).toEqual(["via A", "b1", "a1"]);
    expect(merged.items[0].source).toBe("A");
  });

  it("fills to count from below when duplicates drop out", () => {
    const story = (title: string, ms: number) => ({
      title,
      url: "https://x/shared-story",
      publishedAt: ms,
    });
    const a = feed("A", [story("via A", 300), dated("a1", 100)]);
    const b = feed("B", [story("via B", 200)]);
    // Cap 2: the duplicate drops, so a1 makes the cut instead.
    const merged = mergeFeeds([src(a), src(b)], 2);
    expect(merged.items.map((i) => i.title)).toEqual(["via A", "a1"]);
  });

  it("never dedupes unlinked items (empty URL is not an identity)", () => {
    const bare = (title: string, ms: number) => ({
      title,
      url: "",
      publishedAt: ms,
    });
    const a = feed("A", [bare("first note", 300)]);
    const b = feed("B", [bare("second note", 200)]);
    const merged = mergeFeeds([src(a), src(b)], 10);
    expect(merged.items).toHaveLength(2);
  });

  it("sinks an all-undated feed below dated items instead of floating it up", () => {
    // The undated feed is listed FIRST; it must still land below the dated
    // feed's real timestamps, not pin its items to the top of "newest-first".
    const undatedFeed = feed("Blog", [undated("u1"), undated("u2")]);
    const datedFeed = feed("News", [dated("n2", 200), dated("n1", 100)]);
    const merged = mergeFeeds([src(undatedFeed), src(datedFeed)], 10);
    expect(merged.items.map((i) => i.title)).toEqual(["n2", "n1", "u1", "u2"]);
  });
});

// The fetch/cache layer: stale-while-revalidate with per-URL refresh dedupe.
// Each test uses its own URL — the cache lives on globalThis and survives
// across tests in a run.
describe("fetchFeeds stale-while-revalidate", () => {
  const TTL = 5 * 60_000;
  const rss = (title: string) =>
    `<rss version="2.0"><channel><title>Src</title><item><title>${title}</title><link>https://x.example/${encodeURIComponent(title)}</link></item></channel></rss>`;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("blocks only on a cold cache, then serves the cache within the TTL", async () => {
    const url = "https://swr-cold.example/feed";
    const fetchMock = vi.fn(async () => new Response(rss("v1")));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchFeeds([url], 5))?.items[0].title).toBe("v1");
    expect((await fetchFeeds([url], 5))?.items[0].title).toBe("v1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves an expired entry immediately and refreshes behind the response", async () => {
    const url = "https://swr-stale.example/feed";
    let releaseV2: (() => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(rss("v1")))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseV2 = () => resolve(new Response(rss("v2")));
          })
      );
    vi.stubGlobal("fetch", fetchMock);
    const base = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(base);
    await fetchFeeds([url], 5);

    now.mockReturnValue(base + TTL + 1);
    // The stale entry comes back without waiting on the in-flight v2 fetch.
    expect((await fetchFeeds([url], 5))?.items[0].title).toBe("v1");
    releaseV2!();
    await settle();
    expect((await fetchFeeds([url], 5))?.items[0].title).toBe("v2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent refreshes to one fetch per URL", async () => {
    const url = "https://swr-dedupe.example/feed";
    let release: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response(rss("v1")));
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const both = Promise.all([fetchFeeds([url], 5), fetchFeeds([url], 5)]);
    await settle();
    release!();
    const [a, b] = await both;
    expect(a?.items[0].title).toBe("v1");
    expect(b?.items[0].title).toBe("v1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps serving the last good parse when the refresh fails", async () => {
    const url = "https://swr-fail.example/feed";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(rss("v1")))
      .mockResolvedValue(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const base = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(base);
    await fetchFeeds([url], 5);

    now.mockReturnValue(base + TTL + 1);
    expect((await fetchFeeds([url], 5))?.items[0].title).toBe("v1");
    await settle();
    expect((await fetchFeeds([url], 5))?.items[0].title).toBe("v1");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("fetchFeeds conditional requests", () => {
  const TTL = 5 * 60_000;
  const rss = (title: string) =>
    `<rss version="2.0"><channel><title>Src</title><item><title>${title}</title><link>https://x.example/a</link></item></channel></rss>`;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("revalidates with the stored ETag / Last-Modified and re-arms the TTL on 304", async () => {
    const url = "https://cond.example/feed";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(rss("v1"), {
          headers: {
            ETag: '"tag-1"',
            "Last-Modified": "Fri, 17 Jul 2026 09:00:00 GMT",
          },
        })
      )
      .mockResolvedValue(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);
    const base = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(base);
    await fetchFeeds([url], 5);
    // First request is unconditional.
    expect(fetchMock.mock.calls[0][1].headers["If-None-Match"]).toBeUndefined();

    now.mockReturnValue(base + TTL + 1);
    expect((await fetchFeeds([url], 5))?.items[0].title).toBe("v1");
    await settle();
    const revalidation = fetchMock.mock.calls[1][1].headers;
    expect(revalidation["If-None-Match"]).toBe('"tag-1"');
    expect(revalidation["If-Modified-Since"]).toBe(
      "Fri, 17 Jul 2026 09:00:00 GMT"
    );

    // The 304 re-armed the TTL: a call shortly after serves the cache with no
    // third fetch.
    now.mockReturnValue(base + TTL + 1000);
    expect((await fetchFeeds([url], 5))?.items[0].title).toBe("v1");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stores the new validators when a revalidation returns a fresh body", async () => {
    const url = "https://cond-fresh.example/feed";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(rss("v1"), { headers: { ETag: '"tag-1"' } })
      )
      .mockResolvedValueOnce(
        new Response(rss("v2"), { headers: { ETag: '"tag-2"' } })
      )
      .mockResolvedValue(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);
    const base = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(base);
    await fetchFeeds([url], 5);

    now.mockReturnValue(base + TTL + 1);
    await fetchFeeds([url], 5);
    await settle();
    expect((await fetchFeeds([url], 5))?.items[0].title).toBe("v2");

    now.mockReturnValue(base + 2 * (TTL + 1));
    await fetchFeeds([url], 5);
    await settle();
    expect(fetchMock.mock.calls[2][1].headers["If-None-Match"]).toBe('"tag-2"');
  });
});

describe("feed health recording", () => {
  const rss = (title: string) =>
    `<rss version="2.0"><channel><title>Src</title><item><title>${title}</title><link>https://x.example/a</link></item></channel></rss>`;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records a good fetch as ok with its entry count", async () => {
    const url = "https://health-ok.example/feed";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(rss("v1"))));
    await fetchFeeds([url], 5);
    const h = getFeedHealth()[url];
    expect(h.ok).toBe(true);
    expect(h.count).toBe(1);
    expect(h.at).toBeGreaterThan(0);
  });

  it("records why a fetch failed", async () => {
    const url = "https://health-bad.example/feed";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );
    await fetchFeeds([url], 5);
    expect(getFeedHealth()[url]).toMatchObject({ ok: false, error: "HTTP 500" });
  });

  it("records a non-feed body distinctly from an unreachable host", async () => {
    const url = "https://health-html.example/feed";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body>hi</body></html>"))
    );
    await fetchFeeds([url], 5);
    expect(getFeedHealth()[url]).toMatchObject({
      ok: false,
      error: "Not an RSS, Atom, or JSON feed",
    });
  });
});
