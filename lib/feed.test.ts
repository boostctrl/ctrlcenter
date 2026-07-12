import { describe, expect, it } from "vitest";
import { mergeFeeds, parseFeed, type Feed } from "./feed";

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

  it("sinks an all-undated feed below dated items instead of floating it up", () => {
    // The undated feed is listed FIRST; it must still land below the dated
    // feed's real timestamps, not pin its items to the top of "newest-first".
    const undatedFeed = feed("Blog", [undated("u1"), undated("u2")]);
    const datedFeed = feed("News", [dated("n2", 200), dated("n1", 100)]);
    const merged = mergeFeeds([src(undatedFeed), src(datedFeed)], 10);
    expect(merged.items.map((i) => i.title)).toEqual(["n2", "n1", "u1", "u2"]);
  });
});
