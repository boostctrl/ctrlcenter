// Sample inbound-webhook events for the admin's preview and Send sample
// (#347): a season import, a movie grab, a request awaiting approval and a
// health warning, as Sonarr, Radarr and Seerr would post them. Each is built
// by running the real pipeline — the raw payload through parseWebhook and,
// for the season, eight episode events through mergeDigest the way the burst
// store sends them — so the preview can't drift from what a real event
// becomes. Client-safe (imports only lib/webhooks.ts) so the settings form
// renders it in the browser on every keystroke.

import { mergeDigest, parseWebhook, type WebhookNotification } from "./webhooks";

export const SAMPLE_IDS = ["sonarr-import", "radarr-grab", "seerr-request", "sonarr-health"] as const;
export type SampleId = (typeof SAMPLE_IDS)[number];

export const SAMPLE_LABELS: Record<SampleId, string> = {
  "sonarr-import": "Season import (Sonarr)",
  "radarr-grab": "Movie grab (Radarr)",
  "seerr-request": "Request awaiting approval (Seerr)",
  "sonarr-health": "Health warning (Sonarr)",
};

// A fixed instant for the preview's time line, so the rendered page is the
// same bytes on every render (a Send sample is dated when it goes).
export const SAMPLE_AT = Date.UTC(2026, 9, 10, 18, 42);

// The parsers only take an https poster, so the payloads carry this stand-in
// and finish() swaps in the caller's URL — or drops the poster when there is
// none. It never reaches a renderer: .invalid is reserved and resolves nowhere.
const POSTER_STAND_IN = "https://preview.invalid/poster.jpg";

// The Bear, season 4: title and file size per episode.
const BEAR: [string, number][] = [
  ["Groundhogs", 1503238553],
  ["Soubrette", 1398101333],
  ["Scrap", 1610612736],
  ["Replicants", 1288490188],
  ["Tonnato", 1468006400],
  ["Sophie", 1551892480],
  ["Green", 1363148800],
  ["Goodbye", 1879048192],
];

// One Sonarr Download event for episode `n` (1-based) of the season.
function sonarrImport(n: number): unknown {
  const [title, size] = BEAR[n - 1];
  const release = `The.Bear.S04E${String(n).padStart(2, "0")}.1080p.WEB.H264-NTb`;
  return {
    eventType: "Download",
    instanceName: "Sonarr",
    applicationUrl: "https://sonarr.example.com",
    series: {
      id: 12,
      title: "The Bear",
      year: 2022,
      type: "standard",
      genres: ["Comedy", "Drama"],
      images: [{ coverType: "poster", url: "/MediaCover/12/poster.jpg", remoteUrl: POSTER_STAND_IN }],
    },
    episodes: [{ id: 400 + n, seasonNumber: 4, episodeNumber: n, title, airDate: "2025-06-25" }],
    episodeFile: {
      quality: "WEBDL-1080p",
      qualityVersion: 1,
      releaseGroup: "NTb",
      size,
      sceneName: release,
      languages: [{ id: 1, name: "English" }],
      mediaInfo: { width: 1920, height: 1080, videoCodec: "h264", audioCodec: "EAC3", audioChannels: 5.1 },
    },
    isUpgrade: false,
    release: { releaseTitle: release, indexer: "NZBgeek" },
    downloadClient: "SABnzbd",
    downloadClientType: "Sabnzbd",
    customFormatInfo: { customFormats: [{ id: 3, name: "WEB Tier 01" }], customFormatScore: 1500 },
  };
}

const RADARR_GRAB = {
  eventType: "Grab",
  instanceName: "Radarr",
  applicationUrl: "https://radarr.example.com",
  movie: {
    id: 86,
    title: "Dune: Part Three",
    year: 2026,
    overview:
      "The third chapter of the saga. Paul Atreides, now Emperor, reckons with the holy war waged in his name as the Fremen armies spread across the known worlds, while Chani and the last of the Atreides loyalists search for a path that avoids the future he has seen.",
    genres: ["Science Fiction", "Adventure"],
    images: [{ coverType: "poster", remoteUrl: POSTER_STAND_IN }],
  },
  release: {
    quality: "Bluray-2160p",
    qualityVersion: 1,
    releaseGroup: "FraMeSToR",
    releaseTitle: "Dune.Part.Three.2026.2160p.UHD.BluRay.REMUX.DV.HDR.TrueHD.Atmos.7.1-FraMeSToR",
    indexer: "HDBits",
    size: 62599148339,
    customFormatScore: 1250,
    customFormats: ["Remux Tier 01", "DV HDR10+", "TrueHD Atmos"],
    languages: [{ id: 1, name: "English" }],
    indexerFlags: ["G_Freeleech"],
  },
  downloadClient: "qBittorrent",
};

const SEERR_REQUEST = {
  notification_type: "MEDIA_PENDING",
  event: "New Movie Request",
  subject: "Wicked (2024)",
  message:
    "Elphaba, a young woman misunderstood because of her green skin, and Glinda, a popular girl of privilege and ambition, meet as students at Shiz University in the Land of Oz and forge an unlikely friendship.",
  image: POSTER_STAND_IN,
  media: { media_type: "movie", tmdbId: "402431", tvdbId: "", status: "PENDING", status4k: "UNKNOWN" },
  request: { request_id: "128", requestedBy_username: "mara", requestedBy_email: "mara@example.com" },
  extra: [],
};

// Long enough that the subject is cut at a word, so the preview shows how.
const SONARR_HEALTH = {
  eventType: "Health",
  level: "warning",
  instanceName: "Sonarr",
  applicationUrl: "https://sonarr.example.com",
  message: "Indexers unavailable due to failures for more than 6 hours: NZBgeek, DrunkenSlug",
  type: "IndexerStatusCheck",
  wikiUrl: "https://wiki.servarr.com/sonarr/system#indexers-are-unavailable-due-to-failures",
};

// The flat fields and the report, with the poster the caller asked for, and
// without the digest membership: a sample is never held, and the stand-in
// URL on its items must not leave this module.
function finish(n: WebhookNotification, posterUrl: string | undefined): WebhookNotification {
  const report = n.report && { ...n.report };
  if (report?.image) {
    if (posterUrl) report.image = { ...report.image, url: posterUrl };
    else delete report.image;
  }
  return { title: n.title, body: n.body, url: n.url, ...(report ? { report } : {}) };
}

// A sample event as the channels would get it. `digest` renders the season
// import as the burst store sends it — eight episode events merged into one —
// else as the single event an Off window relays; `posterUrl` is the image
// the report shows, none by default.
export function sampleNotification(
  id: SampleId,
  { digest = false, posterUrl }: { digest?: boolean; posterUrl?: string } = {}
): WebhookNotification {
  switch (id) {
    case "sonarr-import": {
      const first = parseWebhook("sonarr", sonarrImport(1))!;
      if (!digest) return finish(first, posterUrl);
      const burst = BEAR.map((_, i) => parseWebhook("sonarr", sonarrImport(i + 1))!);
      const items = burst.flatMap((n) => n.digest?.items ?? []);
      return finish(mergeDigest({ first, events: burst.length, items, dropped: 0 }), posterUrl);
    }
    case "radarr-grab":
      return finish(parseWebhook("radarr", RADARR_GRAB)!, posterUrl);
    case "seerr-request":
      return finish(parseWebhook("seerr", SEERR_REQUEST)!, posterUrl);
    case "sonarr-health":
      return finish(parseWebhook("sonarr", SONARR_HEALTH)!, posterUrl);
  }
}
