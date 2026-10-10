import { describe, it, expect } from "vitest";
import { buildNotificationEmail, buildSubject, cleanHeader, escapeHtml } from "./webhook-email";
import {
  mergeDigest,
  parseArrWebhook,
  parseSeerrWebhook,
  type NotificationContext,
  type WebhookNotification,
  type WebhookReport,
} from "./webhooks";

const AT = Date.parse("2026-10-10T20:41:00Z");
const ctx: NotificationContext = { at: AT, timeZone: "Europe/Amsterdam", siteTitle: "Home" };

// A notification carrying a report with the given fields on top of a plain
// Sonarr grab.
const withReport = (over: Partial<WebhookReport>): WebhookNotification => ({
  title: "Sonarr grabbed: The Bear S04E03",
  report: {
    service: "sonarr",
    app: "Sonarr",
    eventType: "Grab",
    event: "Grabbed",
    level: "info",
    headline: "The Bear",
    summary: "The Bear S04E03",
    facts: [],
    ...over,
  },
});
const subject = (app: string, event: string, summary: string, prefix?: string) =>
  buildSubject(withReport({ app, event, summary }), prefix);

// The sample every renderer test leans on: a two-episode Sonarr import.
const sonarrImport = parseArrWebhook("sonarr", {
  eventType: "Download",
  instanceName: "Sonarr",
  applicationUrl: "https://sonarr.lan/series/the-bear",
  series: {
    title: "The Bear",
    images: [{ coverType: "poster", remoteUrl: "https://artworks.thetvdb.com/banners/posters/the-bear.jpg" }],
  },
  episodes: [
    { seasonNumber: 4, episodeNumber: 3, title: "Scrap", airDate: "2025-06-25" },
    { seasonNumber: 4, episodeNumber: 4, title: "Replicants", airDate: "2025-06-25" },
  ],
  episodeFile: {
    quality: "WEBDL-1080p",
    releaseGroup: "NTb",
    size: 1503238553,
    mediaInfo: { width: 1920, height: 1080, videoCodec: "h264", audioCodec: "EAC3", audioChannels: 5.1 },
  },
  release: { releaseTitle: "The.Bear.S04E03E04.1080p.WEB.H264-NTb", indexer: "NZBgeek" },
  downloadClient: "SABnzbd",
})!;

describe("buildSubject", () => {
  it("reads [App] Event: Summary for every event kind", () => {
    expect(subject("Sonarr", "Grabbed", "The Bear S04E03")).toBe("[Sonarr] Grabbed: The Bear S04E03");
    expect(subject("Sonarr", "Imported", "The Bear S04E03-E04")).toBe("[Sonarr] Imported: The Bear S04E03-E04");
    expect(subject("Radarr", "Upgraded", "Dune: Part Three (2026)")).toBe("[Radarr] Upgraded: Dune: Part Three (2026)");
    expect(subject("Radarr", "Download failed", "Dune: Part Three (2026)")).toBe(
      "[Radarr] Download failed: Dune: Part Three (2026)"
    );
    expect(
      subject("Sonarr", "Health warning", "Indexers unavailable due to failures for more than 6 hours")
    ).toBe("[Sonarr] Health warning: Indexers unavailable due to…");
    expect(subject("Seerr", "New request", "Wicked (2024) by mara")).toBe("[Seerr] New request: Wicked (2024) by mara");
    expect(subject("Seerr", "Now available", "Wicked (2024)")).toBe("[Seerr] Now available: Wicked (2024)");
    expect(subject("Seerr", "Video issue", "Wicked (2024)")).toBe("[Seerr] Video issue: Wicked (2024)");
  });

  it("drops a trailing year first, then word-cuts the summary", () => {
    const s = subject("Radarr", "Imported", "The Lord of the Rings: The Fellowship of the Ring (2001)");
    expect(s).toBe("[Radarr] Imported: The Lord of the Rings: The Fellowship…");
    expect(s.length).toBe(57);
    // The year alone fits: nothing else goes.
    expect(subject("Radarr", "Imported", "Everything Everywhere All at Once Again (2026)")).toBe(
      "[Radarr] Imported: Everything Everywhere All at Once Again"
    );
  });

  it("caps a runaway summary at 78 without a mid-word cut and with headers cleaned", () => {
    const words = "indexer unavailable because the remote answered slowly again".split(" ");
    const summary = Array.from({ length: 40 }, (_, i) => words[i % words.length]).join(" ").slice(0, 200);
    const s = subject("Sonarr", "Health warning", `${summary.slice(0, 50)}\r\nBcc: evil@x ${summary.slice(50)}`);
    expect(s.length).toBeLessThanOrEqual(78);
    expect(s.endsWith("…")).toBe(true);
    expect(s).not.toMatch(/[\r\n]/);
    const head = "[Sonarr] Health warning: ";
    const cut = s.slice(head.length, -1);
    const clean = `${summary.slice(0, 50)} Bcc: evil@x ${summary.slice(50)}`;
    expect(clean.startsWith(cut)).toBe(true);
    expect(clean[cut.length]).toBe(" ");
  });

  it("puts the prefix first, cleaned, and counts it toward the cap", () => {
    expect(subject("Sonarr", "Grabbed", "The Bear S04E03", "[Home]")).toBe("[Home] [Sonarr] Grabbed: The Bear S04E03");
    expect(subject("Sonarr", "Grabbed", "The Bear S04E03", " Home\r\nnotice ")).toBe(
      "Home notice [Sonarr] Grabbed: The Bear S04E03"
    );
    const prefix = "[A fairly long mailbox rule prefix]";
    const s = subject("Radarr", "Imported", "The Lord of the Rings: The Fellowship of the Ring (2001)", prefix);
    expect(s.startsWith(`${prefix} [Radarr] Imported: `)).toBe(true);
    expect(s.length).toBeLessThanOrEqual(78);
    expect(s.endsWith("…")).toBe(true);
  });

  it("falls back to the cleaned title without a report, and to a word when empty", () => {
    expect(buildSubject({ title: "New request\r\nfor Wicked" })).toBe("New request for Wicked");
    expect(buildSubject({ title: "   " })).toBe("Notification");
    expect(buildSubject({ title: "x".repeat(100) }).length).toBe(78);
  });
});

describe("escaping helpers", () => {
  it("escapes the five HTML specials", () => {
    expect(escapeHtml(`A&B <x> "q" 'z'`)).toBe("A&amp;B &lt;x&gt; &quot;q&quot; &#39;z&#39;");
  });
  it("turns controls into single spaces", () => {
    expect(cleanHeader("a\r\nb\tc\u0000d  e")).toBe("a b c d e");
  });
});

describe("buildNotificationEmail", () => {
  it("renders the real Sonarr import sample: subject, sheet and text part", () => {
    const { subject: s, html, text } = buildNotificationEmail(sonarrImport, ctx);
    expect(s).toBe("[Sonarr] Imported: The Bear S04E03-E04");
    expect(html).toContain("<title>[Sonarr] Imported: The Bear S04E03-E04</title>");
    expect(html).toContain("<h1");
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect(html).toContain('bgcolor="#15803d"');
    expect(html).toContain('<img src="https://artworks.thetvdb.com/banners/posters/the-bear.jpg"');
    expect(html).toContain('alt="The Bear poster"');
    expect(html).toContain('href="https://sonarr.lan/series/the-bear"');
    expect(html).toContain("sonarr.lan");
    expect(html).toContain("The.<wbr>Bear.<wbr>S04E03E04.<wbr>1080p.<wbr>WEB.<wbr>H264-<wbr>NTb");
    const atmos = buildNotificationEmail(
      withReport({ facts: [{ label: "Release", value: "Dune.2026.TrueHD.Atmos.7.1-FraMeSToR", mono: true }] }),
      ctx
    );
    expect(atmos.html).toContain("Dune.<wbr>2026.<wbr>TrueHD.<wbr>Atmos.<wbr>7.1-<wbr>FraMeSToR");
    expect(html).toContain("10:41 PM GMT+2");
    expect(html).toContain('title="2026-10-10T20:41:00.000Z"');
    expect(html).toContain("relayed from Sonarr");
    expect(html).not.toContain("<script");
    expect(html.length).toBeLessThan(60_000);
    expect(text.startsWith("SONARR · IMPORTED\n")).toBe(true);
    expect(text.endsWith("\nUTC 2026-10-10T20:41:00.000Z")).toBe(true);
    expect(text).toContain('Episodes          S04E03 "Scrap"\n                  S04E04 "Replicants"');
    expect(text).toContain("Open in Sonarr: https://sonarr.lan/series/the-bear");
    expect(text).toContain("CtrlCenter · Home · relayed from Sonarr\nOct 10, 2026, 10:41 PM GMT+2");
    expect(text).not.toMatch(/&(amp|lt|gt|quot|#39);/);
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(78);
  });

  it("renders a Seerr request with its overview and a linked TMDB row", () => {
    const n = parseSeerrWebhook({
      notification_type: "MEDIA_PENDING",
      subject: "Wicked (2024)",
      message: "Elphaba & Glinda meet at Shiz.",
      image: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/wicked.jpg",
      media: { media_type: "movie", tmdbId: "402431", status: "PENDING" },
      request: { requestedBy_username: "mara" },
    })!;
    const { subject: s, html, text } = buildNotificationEmail(n, ctx);
    expect(s).toBe("[Seerr] New request: Wicked (2024) by mara");
    expect(html).toContain('bgcolor="#b45309"');
    expect(html).toContain('<a class="link" href="https://www.themoviedb.org/movie/402431"');
    expect(html).toContain("Elphaba &amp; Glinda meet at Shiz.");
    expect(html).toContain(">Overview<");
    expect(text).toContain("TMDB              https://www.themoviedb.org/movie/402431");
    expect(text).toContain("OVERVIEW\nElphaba & Glinda meet at Shiz.");
  });

  it("never links a javascript: URL — the button and a fact become text", () => {
    const n = withReport({
      link: { label: "Open", url: "javascript:alert(1)" },
      facts: [{ label: "Wiki", value: "see here", href: "javascript:alert(1)" }],
    });
    const { html } = buildNotificationEmail(n, ctx);
    expect(html).not.toContain("href=");
    expect(html).toContain("javascript:alert(1)");
    expect(html).toContain("see here");
  });

  it("links http(s) and shows an image only for https", () => {
    const ok = buildNotificationEmail(withReport({ link: { label: "Open", url: "https://sonarr.lan/x" } }), ctx);
    expect(ok.html).toContain('href="https://sonarr.lan/x"');
    const plain = buildNotificationEmail(
      withReport({ image: { url: "http://artworks.thetvdb.com/p.jpg", alt: "The Bear poster" } }),
      ctx
    );
    expect(plain.html).not.toContain("<img");
    const secure = buildNotificationEmail(
      withReport({ image: { url: "https://artworks.thetvdb.com/p.jpg", alt: "The Bear poster" } }),
      ctx
    );
    expect(secure.html).toContain('<img src="https://artworks.thetvdb.com/p.jpg"');
    expect(secure.html).not.toContain("data:");
  });

  it("escapes every payload string: headline, subtitle, alt, facts, message, preheader", () => {
    const evil = `A&B <x> "q" 'z'`;
    const n = withReport({
      headline: evil,
      subtitle: `<b>${evil}</b>`,
      summary: evil,
      message: `<script>${evil}</script>`,
      messageLabel: "Message",
      facts: [{ label: `L<${evil}`, value: evil }],
      image: { url: "https://x/p.jpg", alt: evil },
      preheader: `<i>${evil}</i>`,
    });
    const { html } = buildNotificationEmail(n, ctx);
    expect(html).toContain("A&amp;B &lt;x&gt; &quot;q&quot; &#39;z&#39;");
    expect(html).not.toContain("<x>");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>");
    expect(html).not.toContain("<script");
    expect(html).toContain('alt="A&amp;B &lt;x&gt; &quot;q&quot; &#39;z&#39;"');
    expect(html).toContain("<title>[Sonarr] Grabbed: A&amp;B &lt;x&gt; &quot;q&quot; &#39;z&#39;</title>");
  });

  it("omits the poster, the facts or the synopsis on request", () => {
    const n = withReport({
      image: { url: "https://x/p.jpg", alt: "The Bear poster" },
      facts: [{ label: "Quality", value: "WEBDL-1080p" }],
      message: "An overview nobody asked for.",
      messageLabel: "Overview",
    });
    const full = buildNotificationEmail(n, ctx);
    expect(full.html).toContain("<img");
    expect(full.html).toContain('role="table"');
    expect(full.html).toContain("An overview nobody asked for.");
    expect(full.text).toContain("Quality           WEBDL-1080p");
    const noPoster = buildNotificationEmail(n, { ...ctx, options: { poster: false } });
    expect(noPoster.html).not.toContain("<img");
    expect(noPoster.html).toContain('role="table"');
    const noFacts = buildNotificationEmail(n, { ...ctx, options: { facts: false } });
    expect(noFacts.html).not.toContain('role="table"');
    expect(noFacts.text).not.toContain("WEBDL-1080p");
    expect(noFacts.html).toContain("<img");
    const noSynopsis = buildNotificationEmail(n, { ...ctx, options: { synopsis: false } });
    expect(noSynopsis.html).not.toContain("An overview nobody asked for.");
    expect(noSynopsis.text).not.toContain("OVERVIEW");
    expect(noSynopsis.html).toContain('role="table"');
    const prefixed = buildNotificationEmail(n, { ...ctx, options: { subjectPrefix: "[Home]" } });
    expect(prefixed.subject).toBe("[Home] [Sonarr] Grabbed: The Bear S04E03");
    expect(prefixed.html).toContain("<title>[Home] [Sonarr] Grabbed: The Bear S04E03</title>");
  });

  it("renders a merged burst as one report listing every episode (#346)", () => {
    const burst = Array.from({ length: 8 }, (_, i) =>
      parseArrWebhook("sonarr", {
        eventType: "Download",
        applicationUrl: "https://sonarr.lan/series/the-bear",
        series: { id: 1, title: "The Bear" },
        episodes: [{ id: 100 + i, seasonNumber: 4, episodeNumber: i + 1, title: `Ep ${i + 1}` }],
        episodeFile: { quality: "WEBDL-1080p", size: 1024 ** 3 },
      })!
    );
    const items = burst.flatMap((n) => n.digest?.items ?? []);
    const merged = mergeDigest({ first: burst[0], events: burst.length, items, dropped: 0 });
    const { subject: s, html, text } = buildNotificationEmail(merged, ctx);
    expect(s).toBe("[Sonarr] Imported: The Bear S04E01-E08");
    expect(html).toContain(">8 episodes · Season 4<");
    expect(html).toContain(">Episodes<");
    expect(html).toContain("S04E01 &quot;Ep 1&quot;<br>S04E02 &quot;Ep 2&quot;<br>");
    expect(html).toContain("S04E08 &quot;Ep 8&quot;</td>");
    expect(html).toContain(">8 GB<");
    expect(text).toContain('Episodes          S04E01 "Ep 1"\n                  S04E02 "Ep 2"');
    expect(text).toContain("Size              8 GB");
    expect(text).toContain("Open in Sonarr: https://sonarr.lan/series/the-bear");
  });

  it("degrades an unknown time zone to UTC", () => {
    const { html, text } = buildNotificationEmail(sonarrImport, { ...ctx, timeZone: "Mars/Olympus" });
    expect(html).toContain("8:41 PM UTC");
    expect(text).toContain("Oct 10, 2026, 8:41 PM UTC");
  });

  it("names the instance in the footer only when it differs from the app", () => {
    const named = buildNotificationEmail(withReport({ instance: "Sonarr for the anime shelf" }), ctx);
    expect(named.html).toContain("relayed from Sonarr (Sonarr for the anime shelf)");
    expect(named.text).toContain("relayed from Sonarr (Sonarr for the anime shelf)");
    const same = buildNotificationEmail(withReport({ instance: "Sonarr" }), ctx);
    expect(same.html).toContain("relayed from Sonarr<br>");
  });

  it("still renders a notification without a report, keeping the title as the subject", () => {
    const { subject: s, html, text } = buildNotificationEmail(
      { title: "New request", body: "Wicked", url: "https://seerr.lan/x" },
      ctx
    );
    expect(s).toBe("New request");
    expect(html).toContain("New request");
    expect(html).toContain("Wicked");
    expect(html).toContain('href="https://seerr.lan/x"');
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect(html).not.toContain("relayed from");
    expect(text).toContain("CTRLCENTER · NOTIFICATION\n");
    expect(text).toContain("Wicked");
    expect(text).toContain("Open: https://seerr.lan/x");
    const bad = buildNotificationEmail({ title: "T", url: "javascript:alert(1)" }, ctx);
    expect(bad.html).not.toContain("href=");
    expect(bad.html).toContain("javascript:alert(1)");
  });
});
