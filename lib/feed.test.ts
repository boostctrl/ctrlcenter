import { describe, expect, it } from "vitest";
import { parseFeed } from "./feed";

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
