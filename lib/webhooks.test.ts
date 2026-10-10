import { describe, it, expect } from "vitest";
import {
  parseArrWebhook,
  parseSeerrWebhook,
  parseWebhook,
  toContent,
  mergeDigest,
  fmtBytes,
  episodeCodes,
  clamp,
  type DigestGroup,
  type WebhookNotification,
  type WebhookReport,
} from "./webhooks";
import { buildNotificationRequest } from "./alerts";

const POSTER = "https://artworks.thetvdb.com/banners/posters/the-bear.jpg";
const series = {
  id: 1,
  title: "The Bear",
  year: 2022,
  type: "standard",
  genres: ["Comedy", "Drama"],
  images: [
    { coverType: "banner", url: "/MediaCover/1/banner.jpg", remoteUrl: "https://artworks.thetvdb.com/b.jpg" },
    { coverType: "poster", url: "/MediaCover/1/poster.jpg", remoteUrl: POSTER },
  ],
};
const episodes = [
  { seasonNumber: 4, episodeNumber: 3, title: "Scrap", airDate: "2025-06-25" },
  { seasonNumber: 4, episodeNumber: 4, title: "Replicants", airDate: "2025-06-25" },
];
const labels = (r?: WebhookReport) => r?.facts.map((f) => f.label);
const fact = (r: WebhookReport | undefined, label: string) => r?.facts.find((f) => f.label === label);

describe("parseArrWebhook (Sonarr/Radarr)", () => {
  it("reports a Sonarr grab: series, episode codes, release facts, poster and link", () => {
    const n = parseArrWebhook("sonarr", {
      eventType: "Grab",
      instanceName: "Sonarr",
      applicationUrl: "https://sonarr.lan",
      series,
      episodes: [episodes[0]],
      release: {
        quality: "WEBDL-1080p",
        qualityVersion: 1,
        releaseGroup: "NTb",
        releaseTitle: "The.Bear.S04E03.1080p.WEB.H264-NTb",
        indexer: "NZBgeek",
        size: 1503238553,
        languages: [{ id: 1, name: "English" }],
      },
      downloadClient: "SABnzbd",
      customFormatInfo: { customFormats: [{ id: 1, name: "WEB Tier 01" }], customFormatScore: 1250 },
    });
    expect(n?.title).toBe("Sonarr grabbed: The Bear S04E03");
    expect(n?.body).toBe("WEBDL-1080p · 1.4 GB · NTb · NZBgeek");
    expect(n?.url).toBe("https://sonarr.lan");
    expect(n?.report).toMatchObject({
      service: "sonarr",
      app: "Sonarr",
      event: "Grabbed",
      level: "info",
      headline: "The Bear",
      subtitle: "Season 4 · Episode 3 · Aired Jun 25, 2025",
      summary: "The Bear S04E03",
      image: { url: POSTER, alt: "The Bear poster" },
      link: { label: "Open in Sonarr", url: "https://sonarr.lan" },
    });
    expect(labels(n?.report)).toEqual([
      "Episodes",
      "Quality",
      "Size",
      "Release group",
      "Indexer",
      "Download client",
      "Languages",
      "Custom formats",
      "Release",
    ]);
    expect(fact(n?.report, "Episodes")?.value).toBe('S04E03 "Scrap"');
    expect(fact(n?.report, "Custom formats")?.value).toBe("+1,250 (WEB Tier 01)");
    expect(fact(n?.report, "Release")).toMatchObject({ mono: true });
  });

  it("reports an upgrade import: file quality with media info, a collapsed range, the replaced file", () => {
    const n = parseArrWebhook("sonarr", {
      eventType: "Download",
      series,
      episodes,
      episodeFile: {
        quality: "WEBDL-1080p",
        qualityVersion: 1,
        releaseGroup: "NTb",
        sceneName: "The.Bear.S04E03E04.1080p.WEB.H264-NTb",
        size: 1503238553,
        mediaInfo: { width: 1920, height: 1080, videoCodec: "h264", audioCodec: "EAC3", audioChannels: 5.1 },
      },
      isUpgrade: true,
      deletedFiles: [{ quality: "HDTV-720p" }],
      release: { releaseTitle: "The.Bear.S04E03E04.1080p.WEB.H264-NTb", indexer: "NZBgeek" },
      downloadClientType: "SABnzbd",
    });
    expect(n?.title).toBe("Sonarr upgraded: The Bear S04E03-E04");
    expect(n?.report).toMatchObject({
      event: "Upgraded",
      level: "success",
      subtitle: "Season 4 · Episodes 3–4 · Aired Jun 25, 2025",
      chips: ["WEBDL-1080p", "1.4 GB", "NTb", "NZBgeek", "was HDTV-720p"],
    });
    expect(fact(n?.report, "Episodes")?.value).toBe('S04E03 "Scrap"\nS04E04 "Replicants"');
    expect(fact(n?.report, "Quality")?.value).toBe("WEBDL-1080p · 1920×1080 h264 · EAC3 5.1");
    expect(fact(n?.report, "Replaced")?.value).toBe("HDTV-720p");
    expect(fact(n?.report, "Download client")?.value).toBe("SABnzbd");
  });

  it("folds a season pack's episodeFiles[] into counts and a summed size", () => {
    const file = { quality: "Bluray-1080p", size: 1024 ** 3 };
    const n = parseArrWebhook("sonarr", {
      eventType: "Download",
      series,
      episodes: [1, 2, 3].map((e) => ({ seasonNumber: 4, episodeNumber: e, title: `Ep ${e}` })),
      episodeFiles: [file, file, file],
      fileCount: 3,
      release: { indexer: "HDBits" },
    });
    expect(n?.title).toBe("Sonarr imported: The Bear S04 (3 episodes)");
    expect(n?.report?.event).toBe("Imported");
    expect(labels(n?.report)).toEqual(["Episodes", "Files", "Quality", "Size", "Indexer"]);
    expect(fact(n?.report, "Files")?.value).toBe("3");
    expect(fact(n?.report, "Size")?.value).toBe("3 GB");
    expect(fact(n?.report, "Episodes")?.value.split("\n")).toHaveLength(3);
  });

  it("reports a Radarr import with movie, year, genres and the overview as a message on a grab", () => {
    const movie = {
      title: "Dune: Part Three",
      year: 2026,
      overview: "Paul Atreides unites with the Fremen.",
      genres: ["Science Fiction", "Adventure", "Drama", "Action"],
      images: [{ coverType: "poster", remoteUrl: "https://image.tmdb.org/t/p/original/dune3.jpg" }],
    };
    const imported = parseArrWebhook("radarr", {
      eventType: "Download",
      movie,
      movieFile: { quality: "Bluray-2160p", size: 62599148339 },
      isUpgrade: true,
    });
    expect(imported?.title).toBe("Radarr upgraded: Dune: Part Three (2026)");
    expect(imported?.report).toMatchObject({
      headline: "Dune: Part Three",
      subtitle: "2026 · Movie · Science Fiction, Adventure, Drama",
      summary: "Dune: Part Three (2026)",
    });
    expect(imported?.report?.message).toBeUndefined();
    const grabbed = parseArrWebhook("radarr", {
      eventType: "Grab",
      movie,
      release: { quality: "Bluray-2160p", qualityVersion: 2, indexerFlags: ["G_Freeleech"] },
    });
    expect(grabbed?.report).toMatchObject({
      messageLabel: "Overview",
      message: "Paul Atreides unites with the Fremen.",
    });
    expect(fact(grabbed?.report, "Quality")?.value).toBe("Bluray-2160p · Proper");
    expect(fact(grabbed?.report, "Flags")?.value).toBe("G_Freeleech");
  });

  it("carries a health issue's level, message, check and wiki, with no link when there's no URL", () => {
    const n = parseArrWebhook("sonarr", {
      eventType: "HealthIssue",
      level: "warning",
      message: "Indexer unavailable",
      type: "IndexerStatusCheck",
      wikiUrl: "https://wiki.servarr.com/sonarr/system#indexers",
      applicationUrl: "",
    });
    expect(n?.title).toBe("Sonarr health warning: Indexer unavailable");
    expect(n?.body).toBeUndefined();
    expect(n?.report).toMatchObject({
      event: "Health warning",
      level: "warning",
      headline: "Indexer unavailable",
      summary: "Indexer unavailable",
    });
    expect(n?.report?.link).toBeUndefined();
    expect(fact(n?.report, "Check")?.value).toBe("Indexer status check");
    expect(fact(n?.report, "Wiki")).toMatchObject({
      value: "wiki.servarr.com/sonarr/system#indexers",
      href: "https://wiki.servarr.com/sonarr/system#indexers",
    });
    const severe = parseArrWebhook("radarr", { eventType: "Health", level: "error", message: "Disk full" });
    expect(severe?.report).toMatchObject({ event: "Health error", level: "error" });
    const restored = parseArrWebhook("radarr", { eventType: "HealthRestored", message: "Disk full" });
    expect(restored?.title).toBe("Radarr health restored: Disk full");
    expect(restored?.report?.level).toBe("success");
  });

  it("shows a long health message in full below its clamped lead", () => {
    const message = `Indexers unavailable due to failures for more than 6 hours: ${"NZBgeek, ".repeat(12)}DrunkenSlug`;
    const n = parseArrWebhook("sonarr", { eventType: "Health", level: "warning", message });
    expect(n?.report?.headline.length).toBeLessThanOrEqual(120);
    expect(n?.report?.headline.endsWith("…")).toBe(true);
    expect(n?.report?.message).toBe(message);
    expect(n?.body?.length).toBeLessThanOrEqual(200);
  });

  it("labels a Test event clearly", () => {
    const n = parseArrWebhook("radarr", { eventType: "Test", series: { title: "Test Title" } });
    expect(n?.title).toBe("Radarr test: Webhook connected");
    expect(n?.report).toMatchObject({ event: "Test", headline: "Webhook connected", facts: [] });
    expect(n?.body).toMatch(/wired up/);
  });

  it("labels the other known events and humanizes an unknown one", () => {
    const added = parseArrWebhook("sonarr", {
      eventType: "SeriesAdd",
      series: { title: "Silo", year: 2023, type: "standard", genres: ["Drama", "Sci-Fi"] },
      addMethod: "manual",
    });
    expect(added?.title).toBe("Sonarr added: Silo (2023)");
    expect(added?.report?.subtitle).toBe("2023 · Series");
    expect(labels(added?.report)).toEqual(["Genres", "Added via"]);
    const updated = parseArrWebhook("radarr", {
      eventType: "ApplicationUpdate",
      previousVersion: "5.0.1",
      newVersion: "5.0.2",
      message: "Radarr updated from 5.0.1 to 5.0.2",
    });
    expect(updated?.title).toBe("Radarr updated: 5.0.1 → 5.0.2");
    expect(updated?.report?.headline).toBe("Version 5.0.2");
    const deleted = parseArrWebhook("radarr", {
      eventType: "MovieFileDelete",
      movie: { title: "Flow", year: 2024 },
      movieFile: { relativePath: "Flow (2024).mkv" },
      deleteReason: "Upgrade",
    });
    expect(deleted?.report).toMatchObject({ event: "Deleted", level: "warning" });
    expect(fact(deleted?.report, "Reason")?.value).toBe("Upgrade");
    const attention = parseArrWebhook("sonarr", {
      eventType: "ManualInteractionRequired",
      series,
      episodes: [episodes[0]],
      downloadInfo: { title: "The.Bear.S04E03.mkv", size: 2048 },
      downloadStatus: "Warning",
      downloadStatusMessages: [{ title: "The.Bear.S04E03.mkv", messages: ["No files found", "Sample"] }],
    });
    expect(attention?.title).toBe("Sonarr needs attention: The Bear S04E03");
    expect(attention?.report?.message).toBe("The.Bear.S04E03.mkv: No files found; Sample");
    const unknown = parseArrWebhook("sonarr", { eventType: "SomethingNew", series: { title: "Silo" } });
    expect(unknown?.title).toBe("Sonarr something new: Silo");
  });

  it("takes only https artwork, never the app-local url, and drops a null-suffixed one", () => {
    const n = parseArrWebhook("sonarr", {
      eventType: "Grab",
      series: {
        title: "Silo",
        images: [
          { coverType: "poster", url: "/MediaCover/2/poster.jpg", remoteUrl: "http://artworks.thetvdb.com/p.jpg" },
          { coverType: "fanart", url: "/MediaCover/2/fanart.jpg", remoteUrl: "https://image.tmdb.org/t/p/w600null" },
          { coverType: "banner", url: "/MediaCover/2/banner.jpg", remoteUrl: "https://artworks.thetvdb.com/b.jpg" },
        ],
      },
    });
    expect(n?.report?.image).toEqual({ url: "https://artworks.thetvdb.com/b.jpg", alt: "Silo poster" });
    expect(parseArrWebhook("sonarr", { eventType: "Grab", series: { title: "Silo", images: [] } })?.report?.image)
      .toBeUndefined();
  });

  it("uses a short instanceName as the app and keeps a long one for the footer", () => {
    const short = parseArrWebhook("sonarr", { eventType: "Test", instanceName: "Sonarr 4K" });
    expect(short?.report).toMatchObject({ app: "Sonarr 4K", instance: "Sonarr 4K" });
    const long = parseArrWebhook("sonarr", { eventType: "Test", instanceName: "Sonarr for the anime shelf" });
    expect(long?.report).toMatchObject({ app: "Sonarr", instance: "Sonarr for the anime shelf" });
    expect(parseArrWebhook("radarr", { eventType: "Test", applicationUrl: "ftp://x" })?.report?.link).toBeUndefined();
  });

  it("returns null when there's no eventType", () => {
    expect(parseArrWebhook("sonarr", {})).toBeNull();
    expect(parseArrWebhook("radarr", null)).toBeNull();
  });
});

describe("parseSeerrWebhook", () => {
  const pending = {
    notification_type: "MEDIA_PENDING",
    subject: "Wicked (2024)",
    message: "Elphaba, a young woman misunderstood because of her green skin.",
    image: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/wicked.jpg",
    media: { media_type: "movie", tmdbId: "402431", tvdbId: "", status: "PENDING", status4k: "UNKNOWN" },
    request: { request_id: "128", requestedBy_username: "Sam", requestedBy_email: "sam@example.com" },
    extra: [],
  };

  it("labels a pending request with its subject and requester", () => {
    const n = parseSeerrWebhook(pending);
    expect(n?.title).toBe("Seerr new request: Wicked (2024) by Sam");
    expect(n?.body).toBe("Elphaba, a young woman misunderstood because of her green skin.");
    expect(n?.url).toBeUndefined();
    expect(n?.report).toMatchObject({
      app: "Seerr",
      event: "New request",
      level: "warning",
      headline: "Wicked (2024)",
      subtitle: "Movie · Pending",
      summary: "Wicked (2024) by Sam",
      messageLabel: "Overview",
      image: { url: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/wicked.jpg", alt: "Wicked (2024) poster" },
    });
    expect(n?.report?.link).toBeUndefined();
    expect(labels(n?.report)).toEqual(["Requested by", "Type", "Status", "TMDB"]);
    expect(fact(n?.report, "TMDB")).toEqual({
      label: "TMDB",
      value: "themoviedb.org/movie/402431",
      href: "https://www.themoviedb.org/movie/402431",
    });
    expect(JSON.stringify(n)).not.toContain("sam@example.com");
  });

  it("keeps the extra rows and drops the requester from an availability note", () => {
    const n = parseSeerrWebhook({
      ...pending,
      notification_type: "MEDIA_AVAILABLE",
      subject: "Flow",
      media: { media_type: "tv", tmdbId: 1, status: "PARTIALLY_AVAILABLE" },
      extra: [{ name: "Requested Seasons", value: "1, 2" }],
    });
    expect(n?.title).toBe("Seerr now available: Flow");
    expect(n?.report).toMatchObject({ level: "success", subtitle: "Series · Partially available" });
    expect(fact(n?.report, "Requested seasons")?.value).toBe("1, 2");
    expect(fact(n?.report, "TMDB")?.href).toBe("https://www.themoviedb.org/tv/1");
  });

  it("names the issue type, and puts a comment in the message with the description as a fact", () => {
    const issue = {
      notification_type: "ISSUE_CREATED",
      subject: "Wicked (2024)",
      message: "The audio drops out at 20 minutes.",
      media: { media_type: "movie", tmdbId: "402431", status: "AVAILABLE" },
      issue: { issue_id: "7", issue_type: "VIDEO", issue_status: "OPEN", reportedBy_username: "mara" },
      extra: [
        { name: "Affected Season", value: "1" },
        { name: "Affected Episode", value: "3" },
      ],
    };
    const created = parseSeerrWebhook(issue);
    expect(created?.title).toBe("Seerr video issue: Wicked (2024)");
    expect(created?.report).toMatchObject({ level: "warning", subtitle: "Movie · Open", messageLabel: "Description" });
    expect(labels(created?.report)).toEqual([
      "Reported by",
      "Type",
      "Status",
      "Affected season",
      "Affected episode",
      "TMDB",
    ]);
    const comment = parseSeerrWebhook({
      ...issue,
      notification_type: "ISSUE_COMMENT",
      comment: { comment_message: "Fixed by a re-download.", commentedBy_username: "admin" },
    });
    expect(comment?.title).toBe("Seerr issue comment: Wicked (2024)");
    expect(comment?.report).toMatchObject({ message: "Fixed by a re-download.", messageLabel: "Comment" });
    expect(fact(comment?.report, "Comment by")?.value).toBe("admin");
    expect(fact(comment?.report, "Description")?.value).toBe("The audio drops out at 20 minutes.");
  });

  it("treats {{var}} placeholders and a null-suffixed image as absent", () => {
    const n = parseSeerrWebhook({
      ...pending,
      image: "https://image.tmdb.org/t/p/w600_and_h900_bestv2null",
      request: { requestedBy_username: "{{requestedBy_username}}" },
      media: { media_type: "movie", tmdbId: "{{media_tmdbid}}", status: "PENDING" },
    });
    expect(n?.title).toBe("Seerr new request: Wicked (2024)");
    expect(n?.report?.image).toBeUndefined();
    expect(labels(n?.report)).toEqual(["Type", "Status"]);
  });

  it("labels a test notification", () => {
    const n = parseSeerrWebhook({ notification_type: "TEST_NOTIFICATION", subject: "Test Notification" });
    expect(n?.title).toBe("Seerr test: Webhook connected");
  });

  it("returns null without a notification_type", () => {
    expect(parseSeerrWebhook({})).toBeNull();
  });
});

describe("report helpers", () => {
  it("formats sizes in 1024-based units", () => {
    expect(fmtBytes(1503238553)).toBe("1.4 GB");
    expect(fmtBytes(851443712)).toBe("812 MB");
    expect(fmtBytes(62599148339)).toBe("58.3 GB");
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(0)).toBe("");
    expect(fmtBytes("1")).toBe("");
  });

  it("collapses episode runs within a season and joins seasons", () => {
    const ep = (season: number, episode: number) => ({ season, episode });
    expect(episodeCodes([ep(4, 3)])).toBe("S04E03");
    expect(episodeCodes([ep(4, 4), ep(4, 3), ep(4, 5)])).toBe("S04E03-E05");
    expect(episodeCodes([ep(4, 1), ep(4, 2), ep(4, 3), ep(4, 5)])).toBe("S04E01-E03, E05");
    expect(episodeCodes([ep(5, 1), ep(4, 10)])).toBe("S04E10, S05E01");
    expect(episodeCodes([1, 2, 3, 5, 6].map((s) => ep(s, 1)))).toBe("S01-S03, S05-S06");
    expect(episodeCodes([])).toBe("");
  });

  it("clamps at a word boundary with one ellipsis", () => {
    expect(clamp("The Bear", 20)).toBe("The Bear");
    expect(clamp("The Lord of the Rings: The Fellowship of the Ring", 41)).toBe(
      "The Lord of the Rings: The Fellowship…"
    );
    expect(clamp("Supercalifragilisticexpialidocious indeed", 12)).toBe("Supercalifr…");
  });

  it("flattens a report to one line, a detail and a link", () => {
    const r: WebhookReport = {
      service: "sonarr",
      app: "Sonarr",
      eventType: "Grab",
      event: "Grabbed",
      level: "info",
      headline: "The Bear",
      summary: "The Bear\r\nS04E03",
      chips: ["WEBDL-1080p", ""],
      facts: [],
      link: { label: "Open in Sonarr", url: "https://sonarr.lan" },
    };
    expect(toContent(r)).toMatchObject({
      title: "Sonarr grabbed: The Bear S04E03",
      body: "WEBDL-1080p",
      url: "https://sonarr.lan",
    });
    expect(toContent({ ...r, chips: [], message: "A long overview." }).body).toBe("A long overview.");
  });
});

describe("parseWebhook dispatch", () => {
  it("routes seerr to the Seerr parser", () => {
    expect(
      parseWebhook("seerr", { notification_type: "MEDIA_APPROVED", subject: "X" })?.title
    ).toContain("request approved");
  });
  it("routes sonarr/radarr to the arr parser", () => {
    expect(parseWebhook("radarr", { eventType: "Test" })?.title).toBe("Radarr test: Webhook connected");
  });
});

describe("notification channel shaping", () => {
  const n = { title: "Sonarr grabbed: The Bear S04E03", body: "WEBDL-1080p" };

  it("Discord posts the title + body as content", () => {
    const req = buildNotificationRequest("discord", "https://d/hook", n);
    expect(JSON.parse(req.init.body as string)).toEqual({
      content: "Sonarr grabbed: The Bear S04E03\nWEBDL-1080p",
    });
  });

  it("ntfy sends an ASCII-safe Title header and a non-empty body", () => {
    const req = buildNotificationRequest("ntfy", "https://ntfy/topic", {
      title: "Radarr test: Webhook connected",
    });
    const headers = req.init.headers as Record<string, string>;
    expect(headers.Title).toBe("Radarr test: Webhook connected");
    // No detail → body falls back to the title so ntfy never gets an empty body.
    expect(req.init.body).toBe("Radarr test: Webhook connected");
  });

  it("generic posts a structured JSON envelope", () => {
    const req = buildNotificationRequest("generic", "https://x/hook", {
      title: "T",
      body: "B",
      url: "https://u",
    });
    const payload = JSON.parse(req.init.body as string);
    expect(payload).toMatchObject({ title: "T", message: "B", url: "https://u" });
  });
});

// --- Bursts (#346) ---

// One Sonarr import event for episode `ep` of The Bear, as a season import
// fires them: one episode each, the same file quality, indexer and client.
const imported = (ep: number, over: Record<string, unknown> = {}) =>
  parseArrWebhook("sonarr", {
    eventType: "Download",
    instanceName: "Sonarr",
    applicationUrl: "https://sonarr.lan",
    series,
    episodes: [{ id: 100 + ep, seasonNumber: 4, episodeNumber: ep, title: `Ep ${ep}` }],
    episodeFile: { quality: "WEBDL-1080p", size: 1024 ** 3 },
    release: { indexer: "NZBgeek" },
    downloadClient: "SABnzbd",
    ...over,
  })!;
const movieImported = (i: number) =>
  parseArrWebhook("radarr", {
    eventType: "Download",
    movie: { id: i, title: `Movie ${i}`, year: 2000 + i },
    movieFile: { quality: i % 2 ? "Bluray-1080p" : "WEBDL-1080p", size: 1024 ** 3 },
  })!;
const requested = (id: number, by: string, subject = `Title ${id} (2024)`) =>
  parseSeerrWebhook({
    notification_type: "MEDIA_PENDING",
    subject,
    media: { media_type: "movie", tmdbId: String(id), status: "PENDING" },
    request: { request_id: String(id), requestedBy_username: by },
  })!;
// The group the digest store would hand mergeDigest: items deduped by id in
// arrival order.
const groupOf = (ns: WebhookNotification[], dropped = 0): DigestGroup => {
  const items = new Map(ns.flatMap((n) => n.digest?.items ?? []).map((it) => [it.id, it]));
  return { first: ns[0], events: ns.length, items: [...items.values()], dropped };
};
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("digest membership (#346)", () => {
  it("files a Sonarr import under its series with one item per episode and what the event knew", () => {
    const n = imported(3);
    expect(n.digest).toMatchObject({
      key: "sonarr|Sonarr|Download|1",
      lead: "Sonarr imported {n} episodes of The Bear",
      headline: "The Bear",
      noun: "episodes",
    });
    expect(n.digest?.items).toEqual([
      {
        id: "ep:103",
        label: 'S04E03 "Ep 3"',
        season: 4,
        episode: 3,
        quality: "WEBDL-1080p",
        sizeBytes: 1024 ** 3,
        indexer: "NZBgeek",
        client: "SABnzbd",
        image: { url: POSTER, alt: "The Bear poster" },
        link: { label: "Open in Sonarr", url: "https://sonarr.lan" },
      },
    ]);
    expect(imported(3, { isUpgrade: true }).digest?.lead).toBe("Sonarr upgraded {n} episodes of The Bear");
    const grab = parseArrWebhook("sonarr", {
      eventType: "Grab",
      series,
      episodes: [episodes[0]],
      release: { quality: "WEBDL-1080p", size: 2048, indexer: "NZBgeek" },
    });
    expect(grab?.digest).toMatchObject({ key: "sonarr||Grab|1", lead: "Sonarr grabbed {n} episodes of The Bear" });
    expect(grab?.digest?.items[0]).toMatchObject({ quality: "WEBDL-1080p", sizeBytes: 2048, indexer: "NZBgeek" });
  });

  it("gives a season pack's episodeFiles[] shape the same items, the size on the first", () => {
    const file = { quality: "Bluray-1080p", size: 1024 ** 3 };
    const n = parseArrWebhook("sonarr", {
      eventType: "Download",
      series: { tvdbId: 4242, title: "The Bear" },
      episodes: [1, 2, 3].map((e) => ({ seasonNumber: 4, episodeNumber: e, title: `Ep ${e}` })),
      episodeFiles: [file, file, file],
    });
    expect(n?.digest?.key).toBe("sonarr||Download|4242");
    expect(n?.digest?.items.map((it) => it.id)).toEqual(["ep:S04E01", "ep:S04E02", "ep:S04E03"]);
    expect(n?.digest?.items.map((it) => it.sizeBytes)).toEqual([3 * 1024 ** 3, 0, 0]);
    expect(n?.digest?.items.every((it) => it.quality === "Bluray-1080p")).toBe(true);
  });

  it("groups Radarr by event, a Sonarr series event by event, and Seerr by notification type", () => {
    const movie = movieImported(7);
    expect(movie.digest).toMatchObject({
      key: "radarr||Download",
      lead: "Radarr imported {n} movies",
      headline: "Radarr",
      noun: "movies",
    });
    expect(movie.digest?.items).toMatchObject([{ id: "movie:7", label: "Movie 7 (2007)", quality: "Bluray-1080p" }]);
    const added = parseArrWebhook("sonarr", { eventType: "SeriesAdd", series: { id: 9, title: "Silo", year: 2023 } });
    expect(added?.digest).toMatchObject({ key: "sonarr||SeriesAdd", lead: "Sonarr added {n} series", noun: "series" });
    expect(added?.digest?.items).toMatchObject([{ id: "series:9", label: "Silo (2023)" }]);
    const odd = parseArrWebhook("sonarr", { eventType: "SomethingNew", series: { title: "Silo" } });
    expect(odd?.digest).toMatchObject({ key: "sonarr||SomethingNew", lead: "Sonarr something new: {n} series" });
    expect(odd?.digest?.items).toMatchObject([{ id: "series:Silo", label: "Silo" }]);
    const pending = requested(128, "Sam", "Wicked (2024)");
    expect(pending.digest).toMatchObject({
      key: "seerr|MEDIA_PENDING",
      lead: "Seerr: {n} new requests need approval",
      headline: "Seerr",
      noun: "requests",
    });
    expect(pending.digest?.items).toEqual([{ id: "req:128", label: "Wicked (2024) by Sam", requester: "Sam", image: undefined }]);
    const available = parseSeerrWebhook({ notification_type: "MEDIA_AVAILABLE", subject: "Flow", request: { requestedBy_username: "Sam" } });
    expect(available?.digest).toMatchObject({ lead: "Seerr: {n} requests now available" });
    expect(available?.digest?.items[0]).toMatchObject({ id: "req:Flow", label: "Flow" });
  });

  it("never holds a Test, a health issue, an update, a failure, an attention request, an issue or a subjectless event", () => {
    const never = [
      parseArrWebhook("sonarr", { eventType: "Test", series }),
      parseArrWebhook("sonarr", { eventType: "Health", level: "warning", message: "Indexer unavailable", series }),
      parseArrWebhook("sonarr", { eventType: "HealthIssue", message: "x", series }),
      parseArrWebhook("sonarr", { eventType: "HealthRestored", message: "x", series }),
      parseArrWebhook("radarr", { eventType: "ApplicationUpdate", newVersion: "5.0.2" }),
      parseArrWebhook("sonarr", { eventType: "ManualInteractionRequired", series, episodes: [episodes[0]] }),
      parseArrWebhook("sonarr", { eventType: "DownloadFailed", series, episodes: [episodes[0]] }),
      parseArrWebhook("sonarr", { eventType: "SeriesAdd" }),
      parseArrWebhook("radarr", { eventType: "Download", movieFile: { quality: "Bluray-1080p" } }),
      parseSeerrWebhook({ notification_type: "TEST_NOTIFICATION", subject: "Test Notification" }),
      parseSeerrWebhook({ notification_type: "ISSUE_CREATED", subject: "Wicked (2024)", issue: { issue_type: "VIDEO" } }),
      parseSeerrWebhook({ notification_type: "ISSUE_COMMENT", subject: "Wicked (2024)" }),
      parseSeerrWebhook({ notification_type: "MEDIA_PENDING" }),
    ];
    for (const n of never) {
      expect(n).not.toBeNull();
      expect(n?.digest).toBeUndefined();
    }
  });

  it("keys by the sender's instance, so two instances on one relay URL never merge", () => {
    const key = (instanceName: unknown, service: "sonarr" | "radarr" = "sonarr") =>
      parseArrWebhook(service, {
        eventType: "Download",
        instanceName,
        series,
        episodes: [episodes[0]],
        movie: { id: 7, title: "Flow", year: 2024 },
      })?.digest?.key;
    expect(key("Sonarr")).toBe("sonarr|Sonarr|Download|1");
    expect(key("Sonarr 4K")).toBe("sonarr|Sonarr 4K|Download|1");
    expect(key("Sonarr 4K")).not.toBe(key("Sonarr"));
    expect(key("Sonarr")).toBe(key("Sonarr"));
    expect(key(undefined)).toBe("sonarr||Download|1");
    expect(key("Radarr 4K", "radarr")).toBe("radarr|Radarr 4K|Download");
    expect(key("Radarr", "radarr")).not.toBe(key("Radarr 4K", "radarr"));
    // Cleaned and clamped like every other kept string.
    expect(key("Sonarr\r\n  4K\u0000")).toBe("sonarr|Sonarr 4K|Download|1");
    expect(key("S".repeat(500))?.length).toBeLessThanOrEqual("sonarr||Download|1".length + 120);
  });

  it("bounds what the store keeps: labels and the lead are clamped", () => {
    const n = imported(3, { series: { ...series, title: "T".repeat(500) } });
    expect(n.digest?.lead.length).toBeLessThanOrEqual(200);
    expect(n.digest?.headline.length).toBeLessThanOrEqual(120);
    const long = parseSeerrWebhook({ notification_type: "MEDIA_PENDING", subject: "S".repeat(500) });
    expect(long?.digest?.items[0].label.length).toBeLessThanOrEqual(120);
  });
});

describe("mergeDigest (#346)", () => {
  it("folds a season import into one notification with a range, the list and the shared facts", () => {
    const burst = range(1, 8).map((e) => imported(e));
    const m = mergeDigest(groupOf(burst));
    expect(m.title).toBe("Sonarr imported 8 episodes of The Bear (S04E01-E08)");
    expect(m.body?.split("\n")).toEqual(range(1, 8).map((e) => `S04E0${e} "Ep ${e}"`));
    expect(m.url).toBe("https://sonarr.lan");
    expect(m.digest).toBeUndefined();
    expect(m.report).toMatchObject({
      service: "sonarr",
      app: "Sonarr",
      eventType: "Download",
      event: "Imported",
      level: "success",
      headline: "The Bear",
      subtitle: "8 episodes · Season 4",
      summary: "The Bear S04E01-E08",
      chips: ["WEBDL-1080p", "8 GB", "NZBgeek"],
      image: { url: POSTER, alt: "The Bear poster" },
      link: { label: "Open in Sonarr", url: "https://sonarr.lan" },
    });
    expect(labels(m.report)).toEqual(["Episodes", "Quality", "Size", "Indexer", "Download client"]);
    expect(fact(m.report, "Episodes")?.value.split("\n")).toHaveLength(8);
    expect(fact(m.report, "Size")?.value).toBe("8 GB");
    expect(fact(m.report, "Download client")?.value).toBe("SABnzbd");
    expect(m.report?.message).toBeUndefined();
    // The ntfy Title header takes latin-1 only: the merged title is ASCII.
    expect(/^[\x20-\x7E]*$/.test(m.title)).toBe(true);
  });

  it("compacts gaps, restarts the prefix per season, collapses many seasons, and sorts arrivals", () => {
    const gaps = mergeDigest(groupOf([1, 2, 3, 5, 7, 8].map((e) => imported(e))));
    expect(gaps.title).toBe("Sonarr imported 6 episodes of The Bear (S04E01-E03, E05, E07-E08)");
    const ep = (season: number, episode: number) =>
      imported(episode, { episodes: [{ id: season * 100 + episode, seasonNumber: season, episodeNumber: episode }] });
    const two = mergeDigest(groupOf([...range(1, 10).map((e) => ep(1, e)), ...range(1, 4).map((e) => ep(2, e))]));
    expect(two.title).toBe("Sonarr imported 14 episodes of The Bear (S01E01-E10, S02E01-E04)");
    expect(two.report?.subtitle).toBe("14 episodes · Seasons 1–2");
    const many = mergeDigest(groupOf(range(1, 5).map((s) => ep(s, 1))));
    expect(many.title).toBe("Sonarr imported 5 episodes of The Bear (S01-S05)");
    const shuffled = mergeDigest(groupOf([imported(4), imported(2), imported(3)]));
    expect(shuffled.title).toBe("Sonarr imported 3 episodes of The Bear (S04E02-E04)");
    expect(shuffled.body?.split("\n")[0]).toBe('S04E02 "Ep 2"');
  });

  it("shows a quality, indexer or size only when the items agree, or every one had a size", () => {
    const mixed = mergeDigest(
      groupOf([imported(1), imported(2, { episodeFile: { quality: "Bluray-1080p", size: 1024 ** 3 } })])
    );
    expect(labels(mixed.report)).toEqual(["Episodes", "Size", "Indexer", "Download client"]);
    const sizeless = mergeDigest(groupOf([imported(1), imported(2, { episodeFile: { quality: "WEBDL-1080p" } })]));
    expect(labels(sizeless.report)).toEqual(["Episodes", "Quality", "Indexer", "Download client"]);
    expect(sizeless.report?.chips).toEqual(["WEBDL-1080p", "NZBgeek"]);
  });

  it("lists up to eight items in the body and 24 in the report, then says how many more", () => {
    const m = mergeDigest(groupOf(range(1, 12).map(movieImported)));
    expect(m.title).toBe("Radarr imported 12 movies");
    expect(m.body?.split("\n")).toHaveLength(9);
    expect(m.body?.endsWith("\nand 4 more")).toBe(true);
    expect(m.report).toMatchObject({ headline: "Radarr", subtitle: "12 movies", summary: "12 movies" });
    expect(labels(m.report)).toEqual(["Movies", "Size"]);
    expect(fact(m.report, "Movies")?.value.split("\n")).toHaveLength(12);
    expect(fact(m.report, "Movies")?.value.split("\n")[0]).toBe("Movie 1 (2001)");
    const big = mergeDigest(groupOf(range(1, 30).map((e) => imported(e))));
    const lines = fact(big.report, "Episodes")?.value.split("\n") ?? [];
    expect(lines).toHaveLength(25);
    expect(lines[24]).toBe("and 6 more");
    // Items the store dropped past its cap still count.
    const capped = mergeDigest(groupOf(range(1, 8).map((e) => imported(e)), 92));
    expect(capped.title).toBe("Sonarr imported 100 episodes of The Bear (S04E01-E08)");
    expect(capped.body?.endsWith("\nand 92 more")).toBe(true);
  });

  it("merges a run of requests, naming the requester per item and as a fact only when it's one person", () => {
    const m = mergeDigest(groupOf([requested(1, "Sam"), requested(2, "Mara"), requested(3, "Sam")]));
    expect(m.title).toBe("Seerr: 3 new requests need approval");
    expect(m.body).toBe("Title 1 (2024) by Sam\nTitle 2 (2024) by Mara\nTitle 3 (2024) by Sam");
    expect(m.url).toBeUndefined();
    expect(m.report).toMatchObject({ app: "Seerr", event: "New request", level: "warning", headline: "Seerr", subtitle: "3 requests" });
    expect(labels(m.report)).toEqual(["Requests"]);
    const one = mergeDigest(groupOf([requested(1, "Sam"), requested(2, "Sam")]));
    expect(fact(one.report, "Requested by")?.value).toBe("Sam");
  });

  it("sends a group of one event, or one item, unchanged", () => {
    const only = imported(3);
    expect(mergeDigest(groupOf([only]))).toBe(only);
    const twice = [imported(3), imported(3)];
    expect(mergeDigest(groupOf(twice))).toBe(twice[0]);
    const pack = parseArrWebhook("sonarr", {
      eventType: "Download",
      series,
      episodes: [1, 2, 3].map((e) => ({ seasonNumber: 4, episodeNumber: e })),
      episodeFiles: [{ size: 1 }, { size: 1 }, { size: 1 }],
    })!;
    expect(mergeDigest(groupOf([pack]))).toBe(pack);
  });
});
