// Inbound webhook payload parsers (#204, #345, #346). Sonarr/Radarr/Seerr POST
// an event to /api/hooks/<service>; these pure functions fold each app's
// payload into a WebhookReport — the structured record the email renders in
// full (lib/webhook-email.ts) — and the flat { title, body, url } every other
// alert channel relays (lib/alerts.ts sendNotification). An event that may be
// one of a burst (a season's episodes, one event each) also names the digest
// it joins; lib/webhook-digest.ts holds the burst and mergeDigest() below
// folds it into one notification. Parsing is lenient — the apps let the admin
// choose which triggers fire, and payload shapes drift across versions, so a
// recognized event gets a tidy report and anything else falls back to a
// humanized "<App> <event>: <title>" rather than being dropped. Client-safe
// (imports only ./schema) so a preview can run it in the browser; unit-tested
// directly (no IO here).

import type { WebhookService } from "./schema";

export type NotificationLevel = "info" | "success" | "warning" | "error";

// One labelled row of a report. `value` is plain text ("\n" breaks a line,
// never HTML); `href` links it only when the renderer finds it http(s); `mono`
// marks release and file names for a monospace, breakable rendering.
export type ReportFact = {
  label: string;
  value: string;
  href?: string;
  mono?: boolean;
};

// Everything a channel might show about one event. The email renders it all;
// toContent() flattens it to the one-liner the chat and push channels get.
// Every string here is raw payload text — the renderer escapes.
export type WebhookReport = {
  service: WebhookService;
  // The sender's instanceName when it is short, else the fixed app name.
  app: string;
  // The raw instanceName; the footer shows it only when it differs from app.
  instance?: string;
  // The upstream event id ("Download", "MEDIA_PENDING").
  eventType: string;
  // A fixed label for the event ("Imported") — never payload text.
  event: string;
  level: NotificationLevel;
  // The series or movie title; the event's own line when there is no media.
  headline: string;
  // "Season 4 · Episodes 3–4 · Aired Jun 25, 2025"
  subtitle?: string;
  // The subject tail, and what the other channels say: "The Bear S04E03-E04".
  summary: string;
  // Up to five scan tokens (quality, size, group…) for the preheader and the
  // flat body; the facts carry the same in full.
  chips?: string[];
  facts: ReportFact[];
  messageLabel?: "Overview" | "Message" | "Description" | "Comment";
  // Free text (an overview, a health message); clamped at render.
  message?: string;
  // https only — a plain-http poster would be blocked or mixed-content.
  image?: { url: string; alt: string };
  // The one button; a non-http(s) URL renders as text.
  link?: { label: string; url: string };
  // The hidden inbox preview; the renderer derives summary + chips when absent.
  preheader?: string;
};

// One thing a burst is made of — an episode, a movie, a request — with what
// its own event knew about it, so the merged report can show a quality or a
// size when every item agrees. `id` dedupes a resent event; `season` and
// `episode` let the merged title carry a range.
export type DigestItem = {
  id: string;
  label: string;
  season?: number;
  episode?: number;
  quality?: string;
  sizeBytes?: number;
  indexer?: string;
  client?: string;
  requester?: string;
  image?: WebhookReport["image"];
  link?: WebhookReport["link"];
};

export type DigestNoun = "episodes" | "movies" | "requests" | "series";

// How an event joins a burst (#346): events sharing `key` — the service, the
// sender's instance, the event type and, for a Sonarr series, the series,
// "sonarr|Sonarr 4K|Download|12" — merge into one notification whose title
// is `lead` with {n} for the count — "Sonarr imported {n} episodes of The
// Bear" — and whose report leads with `headline`. Absent when the event is
// never held (a Test, a health issue, anything without a subject).
export type WebhookDigest = {
  key: string;
  lead: string;
  headline: string;
  noun: DigestNoun;
  items: DigestItem[];
};

// What the channels relay: the flat contract every builder reads, plus the
// report the email renders and, for an event that may be one of a burst, the
// digest it joins.
export type WebhookNotification = {
  title: string;
  body?: string;
  url?: string;
  report?: WebhookReport;
  digest?: WebhookDigest;
};

// A burst as the digest store hands it to mergeDigest(): the first event
// whole (sent unchanged when it stayed alone), how many events joined, the
// items kept (deduped by id, in arrival order) and how many were dropped past
// the store's cap — counted so the merged title stays honest.
export type DigestGroup = {
  first: WebhookNotification;
  events: number;
  items: DigestItem[];
  dropped: number;
};

// What a renderer needs beyond the notification: when it happened, the site's
// zone for the local-time line, the site title for the footer, and the admin's
// report options — every field defaults to the full report; the settings that
// feed them come later (#347).
export type ReportOptions = {
  poster?: boolean;
  facts?: boolean;
  synopsis?: boolean;
  subjectPrefix?: string;
};
export type NotificationContext = {
  at: number;
  timeZone: string;
  siteTitle: string;
  options?: ReportOptions;
};

// --- Small value helpers ---

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

// A trimmed string, or "" for anything else — including Seerr's "{{var}}"
// placeholders, which its default JSON template leaves in a field it has no
// value for.
const str = (v: unknown): string => {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return /^\{\{\w+\}\}$/.test(s) ? "" : s;
};
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => list(v).map(str).filter(Boolean);
// An id Seerr sends as a number or a numeric string.
const idOf = (v: unknown): string => {
  const s = typeof v === "number" ? String(v) : str(v);
  return /^\d+$/.test(s) ? s : "";
};
const pad2 = (n: number) => String(n).padStart(2, "0");
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

// "GrabbedFromInteractiveSearch" → "Grabbed from interactive search",
// "PARTIALLY_AVAILABLE" → "Partially available". A last resort for event
// types we don't special-case, so nothing goes unlabeled.
export function humanize(s: string): string {
  const spaced = s
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1).toLowerCase() : s;
}

// "1.4 GB" / "58.3 GB" / "812 MB": 1024-based; one decimal from a gigabyte
// up, where it tells a remux from an encode, whole numbers below.
export function fmtBytes(n: unknown): string {
  if (typeof n !== "number" || !(n > 0)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const s = i < 3 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
  return `${s} ${units[i]}`;
}

// A "YYYY-MM-DD" air date as "Jun 25, 2025"; "" for anything else. Formatted
// in UTC on purpose: an air date is a calendar day, not an instant.
export function fmtDate(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return "";
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium" }).format(d);
}

// Cut at a word boundary with one ellipsis. Mid-word only when no space sits
// past 60% of the room; trailing punctuation goes so it never reads "Title:…".
export function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max < 2) return "…";
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  const kept = sp >= Math.floor(max * 0.6) ? cut.slice(0, sp) : cut;
  return `${kept.replace(/[\s,:;.(–—-]+$/, "")}…`;
}

// A URL stripped to what a reader scans: "themoviedb.org/movie/402431".
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

// Only https: a plain-http poster is blocked by most mail clients, and Seerr's
// template yields ".../bestv2null" when it has no image to offer.
function httpsUrl(v: unknown): string | undefined {
  const s = str(v);
  return /^https:\/\//i.test(s) && !/(null|undefined)$/i.test(s) ? s : undefined;
}
function httpUrl(v: unknown): string | undefined {
  const s = str(v);
  return /^https?:\/\//i.test(s) ? s : undefined;
}

// "3–5, 7" from sorted numbers, with the caller's own label for each. The
// en dash is for prose; an episode code passes "-" (see episodeCodes).
function runs(nums: number[], label: (n: number) => string, dash = "–"): string {
  const out: string[] = [];
  for (let i = 0; i < nums.length; ) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j += 1;
    out.push(j > i ? `${label(nums[i])}${dash}${label(nums[j])}` : label(nums[i]));
    i = j + 1;
  }
  return out.join(", ");
}

type Episode = { id?: number; season: number; episode: number; title: string; airDate: string };

// "S04E03-E05" for a run within one season, "S04E01-E03, E05" with a gap,
// seasons joined with ", "; more than three seasons collapse to "S01-S05".
// An ASCII hyphen, not an en dash: the code reaches ntfy's Title header,
// which takes latin-1 only, and an en dash there would drop the header.
export function episodeCodes(eps: { season: number; episode: number }[]): string {
  const bySeason = new Map<number, Set<number>>();
  for (const e of eps) {
    const set = bySeason.get(e.season) ?? new Set<number>();
    set.add(e.episode);
    bySeason.set(e.season, set);
  }
  const seasons = [...bySeason.keys()].sort((a, b) => a - b);
  if (seasons.length > 3) return runs(seasons, (s) => `S${pad2(s)}`, "-");
  return seasons
    .map((s) => {
      const nums = [...(bySeason.get(s) ?? [])].sort((a, b) => a - b);
      return `S${pad2(s)}${runs(nums, (n) => `E${pad2(n)}`, "-")}`;
    })
    .join(", ");
}

// The sender's instanceName when it reads as a name; a long one would crowd
// the subject and the band, so it falls back to the fixed app name (the raw
// value still reaches the footer as `instance`).
function appOf(p: Record<string, unknown>, fixed: string): string {
  const name = str(p.instanceName);
  return name && name.length <= 20 ? name : fixed;
}

function push(facts: ReportFact[], label: string, value: string, extra?: Partial<ReportFact>) {
  if (value) facts.push({ label, value, ...extra });
}

const unique = (xs: string[]) => [...new Set(xs.filter(Boolean))];

// "Requested Seasons" → "Requested seasons" (an all-caps word stays).
const factLabel = (name: string) =>
  name
    .split(" ")
    .map((w, i) => (i === 0 || w === w.toUpperCase() ? w : w.toLowerCase()))
    .join(" ");

const TEST_MESSAGE = "This was a test event — the webhook is wired up.";

// --- Sonarr / Radarr (shared `eventType` shape) ---

type ArrService = "sonarr" | "radarr";

const ARR_EVENTS: Record<string, [string, NotificationLevel]> = {
  Test: ["Test", "info"],
  Grab: ["Grabbed", "info"],
  Download: ["Imported", "success"],
  DownloadFailed: ["Download failed", "error"],
  ManualInteractionRequired: ["Needs attention", "warning"],
  Health: ["Health warning", "warning"],
  HealthIssue: ["Health warning", "warning"],
  HealthRestored: ["Health restored", "success"],
  ApplicationUpdate: ["Updated", "info"],
  Rename: ["Renamed", "info"],
  SeriesAdd: ["Added", "info"],
  MovieAdded: ["Added", "info"],
  SeriesDelete: ["Deleted", "warning"],
  EpisodeFileDelete: ["Deleted", "warning"],
  MovieDelete: ["Deleted", "warning"],
  MovieFileDelete: ["Deleted", "warning"],
};

const SERIES_TYPES: Record<string, string> = {
  standard: "Series",
  anime: "Anime",
  daily: "Daily series",
};

function episodesOf(p: Record<string, unknown>): Episode[] {
  return list(p.episodes).flatMap((e) => {
    const ep = asRecord(e);
    const season = num(ep.seasonNumber);
    const episode = num(ep.episodeNumber);
    return season === undefined || episode === undefined
      ? []
      : [{ id: num(ep.id), season, episode, title: str(ep.title), airDate: str(ep.airDate) }];
  });
}

// One episode's line: S04E03 "Scrap".
const episodeLine = (e: Episode) =>
  `S${pad2(e.season)}E${pad2(e.episode)}${e.title ? ` "${e.title}"` : ""}`;

// `lines` one per line, stopping at `max` and saying how many of `total`
// remain — a season pack's episodes, a burst's items.
const FACT_LINES = 24;
function lineList(lines: string[], total: number, max: number): string {
  const kept = lines.slice(0, max);
  if (total > max) kept.push(`and ${total - max} more`);
  return kept.join("\n");
}

// One line per episode: S04E03 "Scrap". Long lists (a season pack) stop at
// 24 lines and say how many more.
function episodeLines(eps: Episode[]): string {
  return lineList(eps.map(episodeLine), eps.length, FACT_LINES);
}

// "Season 4 · Episodes 3–4 · Aired Jun 25, 2025". The air date shows only
// when every episode shares it (a season drop); a weekly pair has two.
function episodeSubtitle(eps: Episode[]): string {
  if (!eps.length) return "";
  const seasons = unique(eps.map((e) => String(e.season))).map(Number).sort((a, b) => a - b);
  const parts: string[] = [];
  if (seasons.length === 1) {
    const nums = unique(eps.map((e) => String(e.episode))).map(Number).sort((a, b) => a - b);
    parts.push(`Season ${seasons[0]}`);
    parts.push(nums.length === 1 ? `Episode ${nums[0]}` : `Episodes ${runs(nums, String)}`);
  } else {
    parts.push(`Seasons ${runs(seasons, String)}`, `${eps.length} episodes`);
  }
  const dates = unique(eps.map((e) => e.airDate));
  const aired = dates.length === 1 ? fmtDate(dates[0]) : "";
  if (aired) parts.push(`Aired ${aired}`);
  return parts.join(" · ");
}

// The first https artwork, preferring the poster.
function arrImage(images: unknown, title: string): WebhookReport["image"] {
  const imgs = list(images).map(asRecord);
  for (const type of ["poster", "fanart", "banner"]) {
    const hit = imgs.find((i) => str(i.coverType).toLowerCase() === type);
    const url = hit && httpsUrl(hit.remoteUrl);
    if (url) return { url, alt: title ? `${title} poster` : "Poster" };
  }
  return undefined;
}

type Media = {
  title: string;
  year?: number;
  genres: string[];
  type: string;
  summary: string;
  subtitle?: string;
  image?: WebhookReport["image"];
  episodes: Episode[];
};

// The series or movie an arr event is about, in the words every event shares.
function arrMedia(service: ArrService, p: Record<string, unknown>): Media {
  if (service === "radarr") {
    const movie = asRecord(p.movie);
    const remote = asRecord(p.remoteMovie);
    const title = str(movie.title) || str(remote.title);
    const year = num(movie.year) || num(remote.year) || undefined;
    const genres = strs(movie.genres).slice(0, 3);
    return {
      title,
      year,
      genres,
      type: "Movie",
      summary: title && year ? `${title} (${year})` : title,
      subtitle: title
        ? [year ? String(year) : "", "Movie", genres.join(", ")].filter(Boolean).join(" · ")
        : undefined,
      image: arrImage(movie.images, title),
      episodes: [],
    };
  }
  const series = asRecord(p.series);
  const title = str(series.title);
  const year = num(series.year) || undefined;
  const genres = strs(series.genres).slice(0, 3);
  const type = SERIES_TYPES[str(series.type).toLowerCase()] ?? "Series";
  const episodes = episodesOf(p);
  const codes = episodeCodes(episodes);
  return {
    title,
    year,
    genres,
    type,
    summary: codes ? [title, codes].filter(Boolean).join(" ") : title && year ? `${title} (${year})` : title,
    subtitle: episodes.length
      ? episodeSubtitle(episodes)
      : title
        ? [year ? String(year) : "", type, genres.join(", ")].filter(Boolean).join(" · ")
        : undefined,
    image: arrImage(series.images, title),
    episodes,
  };
}

// "WEBDL-1080p · Proper" — a repack/proper bumps the quality's version.
function qualityOf(r: Record<string, unknown>): string {
  const q = str(r.quality);
  return q && (num(r.qualityVersion) ?? 1) > 1 ? `${q} · Proper` : q;
}

// "1920×1080 h264 HDR10 · EAC3 5.1" from a file's probed mediaInfo.
function mediaInfoOf(file: Record<string, unknown>): string {
  const mi = asRecord(file.mediaInfo);
  const w = num(mi.width);
  const h = num(mi.height);
  const video = [w && h ? `${w}×${h}` : "", str(mi.videoCodec), str(mi.videoDynamicRangeType)]
    .filter(Boolean)
    .join(" ");
  const ch = num(mi.audioChannels);
  const audio = [str(mi.audioCodec), ch ? ch.toFixed(1) : ""].filter(Boolean).join(" ");
  return [video, audio].filter(Boolean).join(" · ");
}

// "+1,250 (Remux, HDR10)" — the score and the names that earned it, when
// either says anything.
function customFormatsOf(p: Record<string, unknown>, release: Record<string, unknown>): string {
  const info = asRecord(p.customFormatInfo);
  const score = num(info.customFormatScore) ?? num(release.customFormatScore) ?? 0;
  const named = list(info.customFormats).map((c) => str(asRecord(c).name)).filter(Boolean);
  const names = named.length ? named : strs(release.customFormats);
  if (!score && !names.length) return "";
  const signed = score ? `${score > 0 ? "+" : ""}${score.toLocaleString("en-US")}` : "";
  if (signed && names.length) return `${signed} (${names.join(", ")})`;
  return signed || names.join(", ");
}

const languagesOf = (v: unknown) =>
  list(v)
    .map((l) => str(asRecord(l).name))
    .filter(Boolean)
    .join(", ");
const clientOf = (p: Record<string, unknown>) => str(p.downloadClient) || str(p.downloadClientType);

// --- Digest membership (#346) ---

// The event labels that read as a verb in a merged title ("Sonarr imported
// {n} episodes of The Bear"); any other label keeps the single-event shape
// ("Sonarr something new: {n} series").
const DIGEST_VERBS = new Set(["Grabbed", "Imported", "Upgraded", "Added", "Deleted", "Renamed"]);

function digestLead(app: string, event: string, noun: DigestNoun, of = ""): string {
  return DIGEST_VERBS.has(event)
    ? `${app} ${lowerFirst(event)} {n} ${noun}${of}`
    : `${app} ${lowerFirst(event)}: {n} ${noun}${of}`;
}

// What the digest store keeps per item and per group is payload text, so it
// is bounded here, where it is made, rather than trusted to stay short.
const MAX_LABEL = 120;
const MAX_LEAD = 200;

function digestOf(d: WebhookDigest): WebhookDigest {
  return {
    ...d,
    lead: clamp(d.lead, MAX_LEAD),
    headline: clamp(d.headline, MAX_LABEL),
    items: d.items.map((it) => ({ ...it, label: clamp(it.label, MAX_LABEL) })),
  };
}

// The sender's instanceName as a key part, control characters and runs of
// whitespace collapsed and clamped like every other kept string: two Sonarr
// (or Radarr) instances posting to the same relay URL never share a group,
// and their ids — series 12 on each — never collide.
const instanceKey = (r: Pick<WebhookReport, "instance">) =>
  clamp((r.instance ?? "").replace(/[\p{Cc}\s]+/gu, " ").trim(), MAX_LABEL);

// Which burst an arr event joins. A Sonarr event about episodes groups by
// instance and series, one item per episode, so a season import reads "8
// episodes of The Bear (S04E01-E08)"; anything else groups by instance and
// event alone — Radarr's payload names no collection — with the series or
// movie as the item. An event with no subject joins nothing.
function arrDigest(
  service: ArrService,
  p: Record<string, unknown>,
  r: Pick<WebhookReport, "app" | "instance" | "eventType" | "event" | "image" | "link">,
  media: Media,
  file: Pick<DigestItem, "quality" | "sizeBytes" | "indexer" | "client">
): WebhookDigest | undefined {
  if (!media.title) return undefined;
  const shared = { image: r.image, link: r.link };
  if (service === "sonarr" && media.episodes.length) {
    const series = asRecord(p.series);
    const sid = num(series.id) ?? num(series.tvdbId) ?? media.title;
    return digestOf({
      key: `sonarr|${instanceKey(r)}|${r.eventType}|${sid}`,
      lead: digestLead(r.app, r.event, "episodes", ` of ${media.title}`),
      headline: media.title,
      noun: "episodes",
      // A multi-episode event's quality, indexer and client hold for each of
      // its episodes; its size belongs to the event (one file can span two
      // episodes), so it rides on the first item and the rest carry 0 — the
      // group's sum stays right either way.
      items: media.episodes.map((e, i) => ({
        id: `ep:${e.id ?? `S${pad2(e.season)}E${pad2(e.episode)}`}`,
        label: episodeLine(e),
        season: e.season,
        episode: e.episode,
        ...file,
        sizeBytes: file.sizeBytes === undefined ? undefined : i === 0 ? file.sizeBytes : 0,
        ...shared,
      })),
    });
  }
  const movie = service === "radarr";
  const subject = asRecord(movie ? p.movie : p.series);
  return digestOf({
    key: `${service}|${instanceKey(r)}|${r.eventType}`,
    lead: digestLead(r.app, r.event, movie ? "movies" : "series"),
    headline: r.app,
    noun: movie ? "movies" : "series",
    items: [
      {
        id: `${movie ? "movie" : "series"}:${num(subject.id) ?? media.title}`,
        label: media.summary,
        ...file,
        ...shared,
      },
    ],
  });
}

export function parseArrWebhook(service: ArrService, payload: unknown): WebhookNotification | null {
  const p = asRecord(payload);
  const eventType = str(p.eventType);
  if (!eventType) return null;
  const fixed = service === "sonarr" ? "Sonarr" : "Radarr";
  const app = appOf(p, fixed);
  const media = arrMedia(service, p);
  const url = httpUrl(p.applicationUrl);
  const [event, level] = ARR_EVENTS[eventType] ?? [humanize(eventType), "info" as const];
  const base = {
    service,
    app,
    instance: str(p.instanceName) || undefined,
    eventType,
    event,
    level,
    headline: media.title || event,
    subtitle: media.subtitle,
    summary: media.summary || "Untitled",
    image: media.image,
    link: url ? { label: `Open in ${app}`, url } : undefined,
  };
  const facts: ReportFact[] = [];
  const release = asRecord(p.release);
  const overview = service === "radarr" ? str(asRecord(p.movie).overview) : "";

  switch (eventType) {
    case "Test":
      return toContent({
        ...base,
        headline: "Webhook connected",
        subtitle: undefined,
        summary: "Webhook connected",
        image: undefined,
        facts,
        message: TEST_MESSAGE,
        messageLabel: "Message",
      });

    case "Grab": {
      const quality = qualityOf(release);
      const size = fmtBytes(release.size);
      const group = str(release.releaseGroup);
      const indexer = str(release.indexer);
      push(facts, "Episodes", episodeLines(media.episodes));
      push(facts, "Quality", quality);
      push(facts, "Size", size);
      push(facts, "Release group", group);
      push(facts, "Indexer", indexer);
      push(facts, "Download client", clientOf(p));
      push(facts, "Languages", languagesOf(release.languages));
      push(facts, "Custom formats", customFormatsOf(p, release));
      push(facts, "Flags", strs(release.indexerFlags).join(", "));
      push(facts, "Release", str(release.releaseTitle), { mono: true });
      return toContent(
        {
          ...base,
          chips: [quality, size, group, indexer].filter(Boolean),
          facts,
          message: overview ? clamp(overview, 300) : undefined,
          messageLabel: overview ? "Overview" : undefined,
        },
        arrDigest(service, p, base, media, {
          quality: quality || undefined,
          sizeBytes: num(release.size),
          indexer: indexer || undefined,
          client: clientOf(p) || undefined,
        })
      );
    }

    case "Download": {
      const files = list(p.episodeFiles).map(asRecord);
      if (files.length > 1) {
        // A season pack lands as one import-complete event listing every
        // file; the per-file detail would be a wall, so it gets the sums.
        const count = num(p.fileCount) ?? files.length;
        const quality = qualityOf(files[0]);
        const bytes = files.reduce((sum, f) => sum + (num(f.size) ?? 0), 0);
        const size = fmtBytes(bytes);
        const indexer = str(release.indexer);
        const seasons = unique(media.episodes.map((e) => String(e.season)));
        const n = media.episodes.length || count;
        const code = seasons.length === 1 ? ` S${pad2(Number(seasons[0]))}` : "";
        push(facts, "Episodes", episodeLines(media.episodes));
        push(facts, "Files", String(count));
        push(facts, "Quality", quality);
        push(facts, "Size", size);
        push(facts, "Indexer", indexer);
        push(facts, "Download client", clientOf(p));
        push(facts, "Release", str(release.releaseTitle), { mono: true });
        return toContent(
          {
            ...base,
            summary: `${media.title || "Untitled"}${code} (${n} episodes)`,
            chips: [quality, size, `${count} files`, indexer].filter(Boolean),
            facts,
          },
          arrDigest(service, p, base, media, {
            quality: quality || undefined,
            sizeBytes: bytes || undefined,
            indexer: indexer || undefined,
            client: clientOf(p) || undefined,
          })
        );
      }
      const file = asRecord(service === "sonarr" ? (p.episodeFile ?? files[0]) : p.movieFile);
      const plain = qualityOf(file) || qualityOf(release);
      const bytes = num(file.size) || num(release.size);
      const size = fmtBytes(bytes);
      const group = str(file.releaseGroup) || str(release.releaseGroup);
      const indexer = str(release.indexer);
      const replaced = unique(list(p.deletedFiles).map((f) => str(asRecord(f).quality))).join(", ");
      push(facts, "Episodes", episodeLines(media.episodes));
      push(facts, "Quality", [plain, mediaInfoOf(file)].filter(Boolean).join(" · "));
      push(facts, "Size", size);
      push(facts, "Replaced", replaced);
      push(facts, "Release group", group);
      push(facts, "Indexer", indexer);
      push(facts, "Download client", clientOf(p));
      push(facts, "Languages", languagesOf(file.languages) || languagesOf(release.languages));
      push(facts, "Custom formats", customFormatsOf(p, release));
      push(facts, "Release", str(release.releaseTitle) || str(file.sceneName), { mono: true });
      const upgrade = p.isUpgrade === true;
      const event = upgrade ? "Upgraded" : "Imported";
      const digest = arrDigest(service, p, { ...base, event }, media, {
        quality: plain || undefined,
        sizeBytes: bytes || undefined,
        indexer: indexer || undefined,
        client: clientOf(p) || undefined,
      });
      return toContent(
        {
          ...base,
          event,
          chips: [plain, size, group, indexer, replaced ? `was ${replaced}` : ""].filter(Boolean),
          facts,
        },
        digest
      );
    }

    case "DownloadFailed":
      push(facts, "Quality", qualityOf(release));
      push(facts, "Release", str(release.releaseTitle), { mono: true });
      return toContent({
        ...base,
        facts,
        message: str(p.message) || undefined,
        messageLabel: str(p.message) ? "Message" : undefined,
      });

    case "ManualInteractionRequired": {
      const info = asRecord(p.downloadInfo);
      push(facts, "Download", str(info.title), { mono: true });
      push(facts, "Status", str(p.downloadStatus));
      push(facts, "Size", fmtBytes(info.size));
      push(facts, "Download client", clientOf(p));
      const message = list(p.downloadStatusMessages)
        .map((m) => {
          const r = asRecord(m);
          const title = str(r.title);
          const detail = strs(r.messages).join("; ");
          return title && detail ? `${title}: ${detail}` : title || detail;
        })
        .filter(Boolean)
        .join("\n");
      return toContent({
        ...base,
        facts,
        message: message || undefined,
        messageLabel: message ? "Message" : undefined,
      });
    }

    case "Health":
    case "HealthIssue":
    case "HealthRestored": {
      const message = str(p.message);
      const restored = eventType === "HealthRestored";
      const severe = str(p.level).toLowerCase() === "error";
      const headline = message ? clamp(message, 120) : event;
      push(facts, "Check", humanize(str(p.type)));
      const wiki = httpUrl(p.wikiUrl);
      if (wiki) push(facts, "Wiki", displayUrl(wiki), { href: wiki });
      return toContent({
        ...base,
        event: restored ? event : severe ? "Health error" : event,
        level: restored ? level : severe ? "error" : level,
        headline,
        subtitle: undefined,
        summary: headline,
        image: undefined,
        facts,
        // The headline carries a short message whole; a long one shows in
        // full below its clamped lead.
        message: message.length > 120 ? message : undefined,
        messageLabel: message.length > 120 ? "Message" : undefined,
      });
    }

    case "ApplicationUpdate": {
      const prev = str(p.previousVersion);
      const next = str(p.newVersion);
      const message = str(p.message);
      push(facts, "Previous version", prev);
      push(facts, "New version", next);
      return toContent({
        ...base,
        headline: next ? `Version ${next}` : event,
        subtitle: undefined,
        summary: prev && next ? `${prev} → ${next}` : next || message || event,
        image: undefined,
        facts,
        message: message || undefined,
        messageLabel: message ? "Message" : undefined,
      });
    }

    case "Rename": {
      const renamed = list(service === "sonarr" ? p.renamedEpisodeFiles : p.renamedMovieFiles).map(
        asRecord
      );
      const lines = renamed
        .slice(0, 3)
        .map((f) => [str(f.previousRelativePath), str(f.relativePath)].filter(Boolean).join(" → "))
        .filter(Boolean);
      if (renamed.length > 3) lines.push(`and ${renamed.length - 3} more`);
      if (renamed.length) push(facts, "Files", String(renamed.length));
      push(facts, "Renamed", lines.join("\n"), { mono: true });
      return toContent({ ...base, facts }, arrDigest(service, p, base, media, {}));
    }

    case "SeriesAdd":
    case "MovieAdded": {
      push(facts, "Genres", media.genres.join(", "));
      push(facts, "Added via", humanize(str(p.addMethod)));
      return toContent(
        {
          ...base,
          // The type says what was added; the genres move to a row.
          subtitle: media.title
            ? [media.year ? String(media.year) : "", media.type].filter(Boolean).join(" · ")
            : undefined,
          facts,
          message: overview ? clamp(overview, 300) : undefined,
          messageLabel: overview ? "Overview" : undefined,
        },
        arrDigest(service, p, base, media, {})
      );
    }

    case "SeriesDelete":
    case "EpisodeFileDelete":
    case "MovieDelete":
    case "MovieFileDelete": {
      const file = asRecord(service === "sonarr" ? p.episodeFile : p.movieFile);
      push(facts, "Reason", humanize(str(p.deleteReason)));
      if (typeof p.deletedFiles === "boolean") push(facts, "Files deleted", p.deletedFiles ? "Yes" : "No");
      push(facts, "File", str(file.relativePath), { mono: true });
      push(facts, "Size", fmtBytes(p.movieFolderSize));
      return toContent({ ...base, facts }, arrDigest(service, p, base, media, {}));
    }

    default:
      return toContent(
        { ...base, headline: media.title || app, summary: media.summary || app, facts },
        arrDigest(service, p, base, media, {})
      );
  }
}

// --- Seerr (the merged Overseerr / Jellyseerr), keyed by `notification_type` ---

const SEERR_EVENTS: Record<string, [string, NotificationLevel]> = {
  MEDIA_PENDING: ["New request", "warning"],
  MEDIA_APPROVED: ["Request approved", "success"],
  MEDIA_AUTO_APPROVED: ["Auto-approved", "success"],
  MEDIA_AUTO_REQUESTED: ["Auto-requested", "info"],
  MEDIA_DECLINED: ["Request declined", "warning"],
  MEDIA_AVAILABLE: ["Now available", "success"],
  MEDIA_FAILED: ["Request failed", "error"],
  ISSUE_CREATED: ["Issue reported", "warning"],
  ISSUE_COMMENT: ["Issue comment", "info"],
  ISSUE_RESOLVED: ["Issue resolved", "success"],
  ISSUE_REOPENED: ["Issue reopened", "warning"],
};

const ISSUE_TYPES: Record<string, string> = {
  VIDEO: "Video",
  AUDIO: "Audio",
  SUBTITLES: "Subtitle",
};

// The merged title for a run of like requests (#346); an unlisted MEDIA_
// event reads "Seerr <event>: {n} requests". Issues are never held — each is
// someone's problem, and a comment thread merged would lose its order.
const SEERR_DIGEST_LEADS: Record<string, string> = {
  MEDIA_PENDING: "Seerr: {n} new requests need approval",
  MEDIA_APPROVED: "Seerr: {n} requests approved",
  MEDIA_AUTO_APPROVED: "Seerr: {n} requests auto-approved",
  MEDIA_AUTO_REQUESTED: "Seerr: {n} titles auto-requested",
  MEDIA_DECLINED: "Seerr: {n} requests declined",
  MEDIA_AVAILABLE: "Seerr: {n} requests now available",
  MEDIA_FAILED: "Seerr: {n} requests failed",
};

export function parseSeerrWebhook(payload: unknown): WebhookNotification | null {
  const p = asRecord(payload);
  const nt = str(p.notification_type);
  if (!nt) return null;
  const base = { service: "seerr" as const, app: "Seerr", eventType: nt };
  if (nt === "TEST_NOTIFICATION") {
    return toContent({
      ...base,
      event: "Test",
      level: "info",
      headline: "Webhook connected",
      summary: "Webhook connected",
      facts: [],
      message: TEST_MESSAGE,
      messageLabel: "Message",
    });
  }
  const media = asRecord(p.media);
  const request = asRecord(p.request);
  const issue = asRecord(p.issue);
  const comment = asRecord(p.comment);
  const known = SEERR_EVENTS[nt];
  const level: NotificationLevel = known ? known[1] : "info";
  let event = known ? known[0] : humanize(nt);
  const isIssue = nt.startsWith("ISSUE_");
  if (nt === "ISSUE_CREATED") {
    const kind = ISSUE_TYPES[str(issue.issue_type).toUpperCase()];
    if (kind) event = `${kind} issue`;
  }
  const subject = str(p.subject);
  const message = str(p.message);
  const mediaType = str(media.media_type).toLowerCase();
  const type = mediaType === "movie" ? "Movie" : mediaType === "tv" ? "Series" : "";
  const status = humanize(str(isIssue ? issue.issue_status : media.status));
  const requester = str(request.requestedBy_username);
  // The requester names a request; an availability note goes to them, and an
  // issue is someone else's.
  const by = !isIssue && nt !== "MEDIA_AVAILABLE" && requester ? ` by ${requester}` : "";

  const facts: ReportFact[] = [];
  if (nt === "ISSUE_COMMENT") push(facts, "Comment by", str(comment.commentedBy_username));
  else if (isIssue) push(facts, "Reported by", str(issue.reportedBy_username));
  else push(facts, "Requested by", requester);
  push(facts, "Type", type);
  push(facts, "Status", status);
  // "Requested Seasons", "Affected Season/Episode" — whatever Seerr adds.
  for (const x of list(p.extra)) {
    const row = asRecord(x);
    const name = str(row.name);
    if (name) push(facts, factLabel(name), str(row.value));
  }
  // A comment's message is the issue's description; the new comment is the
  // message of the report.
  if (nt === "ISSUE_COMMENT") push(facts, "Description", clamp(message, 300));
  const tmdb = idOf(media.tmdbId);
  if (tmdb && (mediaType === "movie" || mediaType === "tv")) {
    const href = `https://www.themoviedb.org/${mediaType}/${tmdb}`;
    push(facts, "TMDB", displayUrl(href), { href });
  }

  const text = nt === "ISSUE_COMMENT" ? str(comment.comment_message) : message;
  const url = httpsUrl(p.image);
  const image = url ? { url, alt: `${subject || "Media"} poster` } : undefined;
  // A request event with a subject may be one of a run; the item names the
  // requester so a burst from several people still says who asked.
  const digest =
    nt.startsWith("MEDIA_") && subject
      ? digestOf({
          key: `seerr|${nt}`,
          lead: SEERR_DIGEST_LEADS[nt] ?? `Seerr ${lowerFirst(event)}: {n} requests`,
          headline: "Seerr",
          noun: "requests",
          items: [
            {
              id: `req:${idOf(request.request_id) || subject}`,
              label: subject + by,
              requester: requester || undefined,
              image,
            },
          ],
        })
      : undefined;
  return toContent(
    {
      ...base,
      event,
      level,
      headline: subject || event,
      subtitle: [type, status].filter(Boolean).join(" · ") || undefined,
      summary: (subject || event) + by,
      facts,
      message: text || undefined,
      messageLabel: text ? (nt === "ISSUE_COMMENT" ? "Comment" : isIssue ? "Description" : "Overview") : undefined,
      image,
    },
    digest
  );
}

// Flatten a report to what the chat and push channels relay — one line, a
// short detail, a link — and carry the report along for the email, and the
// digest for the burst store when the event may be one of a burst. Payload
// text can hold newlines; the title becomes an ntfy header, so it gets one
// line.
export function toContent(r: WebhookReport, digest?: WebhookDigest): WebhookNotification {
  const summary = r.summary.replace(/\s+/g, " ").trim();
  const chips = (r.chips ?? []).filter(Boolean);
  const body = chips.length ? chips.join(" · ") : r.message ? clamp(r.message, 200) : undefined;
  return {
    title: `${r.app} ${lowerFirst(r.event)}: ${summary}`,
    body,
    url: r.link?.url,
    report: { ...r, summary },
    ...(digest ? { digest } : {}),
  };
}

// --- Merging a burst (#346) ---

const NOUN_LABELS: Record<DigestNoun, string> = {
  episodes: "Episodes",
  movies: "Movies",
  requests: "Requests",
  series: "Series",
};
// The flat body lists this many items; the report's fact lists FACT_LINES.
const BODY_LINES = 8;

// A value every item carries and agrees on, else "".
function uniform(items: DigestItem[], pick: (it: DigestItem) => string | undefined): string {
  const first = pick(items[0]) ?? "";
  return first && items.every((it) => pick(it) === first) ? first : "";
}

// Fold a burst into the one notification that goes out: the lead with its
// count and, when every item is an episode, the range — "Sonarr imported 8
// episodes of The Bear (S04E01-E08)" — over a body listing up to eight items,
// and a report whose facts list the items and carry a quality, indexer,
// client or requester only when the items agree, and a size only when every
// item had one (their sum). A group that saw one event, or holds one item,
// sends that event unchanged: its own wording and facts say more than a
// count of one. Pure, so it is unit-tested apart from the timers that decide
// when it runs.
export function mergeDigest(g: DigestGroup): WebhookNotification {
  const d = g.first.digest;
  const n = g.items.length + g.dropped;
  if (!d || g.events === 1 || n === 1) return g.first;
  const coded = g.items.every((it) => it.season !== undefined && it.episode !== undefined);
  const items = coded
    ? [...g.items].sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0))
    : g.items;
  const codes = coded
    ? episodeCodes(items.map((it) => ({ season: it.season ?? 0, episode: it.episode ?? 0 })))
    : "";
  const count = d.lead.replace("{n}", String(n));
  const title = codes ? `${count} (${codes})` : count;
  const labels = items.map((it) => it.label);
  const body = lineList(labels, n, BODY_LINES);
  const r = g.first.report;
  const link = items.find((it) => it.link)?.link ?? r?.link;
  const url = link?.url ?? g.first.url;
  if (!r) return { title, body, url };
  let subtitle = `${n} ${d.noun}`;
  if (coded) {
    const seasons = unique(items.map((it) => String(it.season))).map(Number).sort((a, b) => a - b);
    subtitle += ` · ${seasons.length === 1 ? `Season ${seasons[0]}` : `Seasons ${runs(seasons, String)}`}`;
  }
  const quality = uniform(items, (it) => it.quality);
  const size = items.every((it) => typeof it.sizeBytes === "number")
    ? fmtBytes(items.reduce((sum, it) => sum + (it.sizeBytes ?? 0), 0))
    : "";
  const indexer = uniform(items, (it) => it.indexer);
  const facts: ReportFact[] = [];
  push(facts, NOUN_LABELS[d.noun], lineList(labels, n, FACT_LINES));
  push(facts, "Quality", quality);
  push(facts, "Size", size);
  push(facts, "Indexer", indexer);
  push(facts, "Download client", uniform(items, (it) => it.client));
  push(facts, "Requested by", uniform(items, (it) => it.requester));
  return {
    title,
    body,
    url,
    report: {
      service: r.service,
      app: r.app,
      instance: r.instance,
      eventType: r.eventType,
      event: r.event,
      level: r.level,
      headline: d.headline,
      subtitle,
      summary: codes ? `${d.headline} ${codes}` : `${n} ${d.noun}`,
      chips: [quality, size, indexer].filter(Boolean),
      facts,
      image: items.find((it) => it.image)?.image ?? r.image,
      link,
    },
  };
}

// Dispatch to the right parser for the addressed service.
export function parseWebhook(service: WebhookService, payload: unknown): WebhookNotification | null {
  return service === "seerr" ? parseSeerrWebhook(payload) : parseArrWebhook(service, payload);
}
