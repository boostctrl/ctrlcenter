// Typed client for the Sonarr and Radarr v3 APIs (#191). One implementation —
// the two share nearly every shape — with small per-kind differences where the
// APIs genuinely diverge (episodes vs movies). Server-side only; the API key
// never reaches the browser.
//
// The card answers "what's coming to my library, and what just landed": the
// next couple of weeks of the calendar (upcoming episodes / movie releases),
// the most recent grabs and imports from history, and any health warnings.

import {
  serviceBase,
  serviceRequest,
  parseJson,
  throwForStatus,
  runProbe,
  type ProbeResult,
} from "./http";

export type ArrKind = "sonarr" | "radarr";

export type ArrConfig = { url: string; apiKey: string };

// One row of the "upcoming" list: a series/movie title, a short qualifier
// (episode code, or the release kind for a movie), and when it airs/releases.
export type ArrUpcomingItem = {
  title: string;
  subtitle: string;
  // Air/release time (epoch ms), or null when the record had no usable date.
  at: number | null;
} & ArrArt;

// A row's poster (the service's own https artwork address) and where it
// opens in the service, when the record carried them (#522).
export type ArrArt = { poster?: string; href?: string };

// One row of the "recent" list: something grabbed or imported, newest first.
export type ArrRecentItem = {
  title: string;
  subtitle: string;
  event: "grabbed" | "imported";
  // When the event happened (epoch ms), or null.
  at: number | null;
} & ArrArt;

export type ArrHealthItem = { type: "notice" | "warning" | "error"; message: string };

export type ArrSnapshot = {
  upcoming: ArrUpcomingItem[];
  recent: ArrRecentItem[];
  health: ArrHealthItem[];
};

export const ARR_UPCOMING_CAP = 6;
// The glance headlines recent grab/import activity over the last week, so keep
// enough recent history for an accurate "this week" count and its bar strip.
export const ARR_RECENT_CAP = 14;
const HEALTH_CAP = 5;
// How far ahead the "upcoming" window looks.
const UPCOMING_WINDOW_DAYS = 14;
// History page to scan before filtering down to grabs/imports (other event
// types — renames, deletions — are skipped).
const HISTORY_PAGE_SIZE = 25;

// --- Raw API shapes (only the fields the snapshot uses) ---

type RawImage = { coverType?: string; remoteUrl?: string };
type RawSeries = { title?: string; titleSlug?: string; images?: RawImage[] };
type RawMovie = { title?: string; year?: number; tmdbId?: number; images?: RawImage[] };
type RawCalendarEpisode = {
  airDateUtc?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  title?: string;
  series?: RawSeries;
};
type RawCalendarMovie = {
  title?: string;
  year?: number;
  tmdbId?: number;
  images?: RawImage[];
  inCinemas?: string;
  digitalRelease?: string;
  physicalRelease?: string;
};
type RawHistoryPage = { records?: RawHistoryRecord[] };
type RawHistoryRecord = {
  eventType?: string;
  date?: string;
  series?: RawSeries;
  episode?: { seasonNumber?: number; episodeNumber?: number };
  movie?: RawMovie;
};
type RawHealth = { type?: string; message?: string };

async function arrJson<T>(
  kind: ArrKind,
  cfg: ArrConfig,
  path: string
): Promise<T> {
  const base = serviceBase(cfg.url);
  const { res, text } = await serviceRequest(`${base}${path}`, {
    headers: { "X-Api-Key": cfg.apiKey },
  });
  // 401 has exactly one meaning here; say it in the admin's terms.
  throwForStatus(res, { 401: "Invalid API key" });
  return parseJson<T>(text);
}

// --- Pure parse helpers ---

const toMs = (s?: string): number | null => {
  if (typeof s !== "string" || s === "") return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
};
const pad2 = (n: number) => String(n).padStart(2, "0");
const seasonEp = (s?: number, e?: number): string =>
  typeof s === "number" && typeof e === "number" ? `S${pad2(s)}E${pad2(e)}` : "";
// Earliest first; undated rows sort to the end.
const byAtAsc = (a: { at: number | null }, b: { at: number | null }) =>
  (a.at ?? Infinity) - (b.at ?? Infinity);

// The poster among a record's images: its public https address (the
// service's own copy needs the API key, which never reaches the browser).
function posterOf(images: unknown): string | undefined {
  if (!Array.isArray(images)) return undefined;
  const hit = (images as RawImage[]).find((i) => i?.coverType === "poster");
  const url = typeof hit?.remoteUrl === "string" ? hit.remoteUrl : "";
  return /^https:\/\//.test(url) && url.length <= 500 ? url : undefined;
}
// A series' or movie's poster and its page in the service. `base` is the
// integration's address; without one (the tile's snapshot) there's no link.
function seriesArt(series: RawSeries | undefined, base?: string): ArrArt {
  const poster = posterOf(series?.images);
  const slug = typeof series?.titleSlug === "string" ? series.titleSlug : "";
  return {
    ...(poster ? { poster } : {}),
    ...(base && slug ? { href: `${base}/series/${encodeURIComponent(slug)}` } : {}),
  };
}
function movieArt(movie: RawMovie | undefined, base?: string): ArrArt {
  const poster = posterOf(movie?.images);
  return {
    ...(poster ? { poster } : {}),
    ...(base && typeof movie?.tmdbId === "number" ? { href: `${base}/movie/${movie.tmdbId}` } : {}),
  };
}

export function mapSonarrCalendar(raw: unknown, base?: string): ArrUpcomingItem[] {
  const arr = Array.isArray(raw) ? (raw as RawCalendarEpisode[]) : [];
  return arr
    .map(
      (e): ArrUpcomingItem => ({
        title: e.series?.title?.trim() || "(unknown series)",
        subtitle: seasonEp(e.seasonNumber, e.episodeNumber),
        at: toMs(e.airDateUtc),
        ...seriesArt(e.series, base),
      })
    )
    .sort(byAtAsc)
    .slice(0, ARR_UPCOMING_CAP);
}

export function mapRadarrCalendar(raw: unknown, base?: string): ArrUpcomingItem[] {
  const arr = Array.isArray(raw) ? (raw as RawCalendarMovie[]) : [];
  const now = Date.now();
  return arr
    .map((m): ArrUpcomingItem => {
      // A calendar movie can carry several release dates; show the soonest
      // one still ahead of us, else the soonest overall.
      const dates: { label: string; at: number }[] = [];
      for (const [label, value] of [
        ["Digital", m.digitalRelease],
        ["Physical", m.physicalRelease],
        ["Cinemas", m.inCinemas],
      ] as const) {
        const at = toMs(value);
        if (at !== null) dates.push({ label, at });
      }
      const ahead = dates.filter((d) => d.at >= now).sort((a, b) => a.at - b.at);
      const pick = ahead[0] ?? dates.sort((a, b) => a.at - b.at)[0];
      return {
        title: m.title?.trim() || "(unknown movie)",
        subtitle: [m.year ? String(m.year) : "", pick?.label ?? ""]
          .filter(Boolean)
          .join(" · "),
        at: pick?.at ?? null,
        ...movieArt(m, base),
      };
    })
    .sort(byAtAsc)
    .slice(0, ARR_UPCOMING_CAP);
}

// History event types that count as "imported" (the file landed in the
// library). Grabs are matched separately; every other event is skipped.
const IMPORT_EVENTS = new Set([
  "downloadFolderImported",
  "movieFileImported",
  "episodeFileImported",
  "seriesFolderImported",
]);

export function mapHistory(
  kind: ArrKind,
  raw: unknown,
  cap: number = ARR_RECENT_CAP,
  base?: string
): ArrRecentItem[] {
  const page = (raw ?? {}) as RawHistoryPage;
  const records = Array.isArray(page.records) ? page.records : [];
  const out: ArrRecentItem[] = [];
  for (const r of records) {
    const et = typeof r.eventType === "string" ? r.eventType : "";
    let event: "grabbed" | "imported" | null = null;
    if (et === "grabbed") event = "grabbed";
    else if (IMPORT_EVENTS.has(et) || /imported/i.test(et)) event = "imported";
    if (!event) continue;
    const title =
      kind === "sonarr"
        ? r.series?.title?.trim() || "(unknown)"
        : r.movie?.title?.trim() || "(unknown)";
    const subtitle =
      kind === "sonarr"
        ? seasonEp(r.episode?.seasonNumber, r.episode?.episodeNumber)
        : r.movie?.year
          ? String(r.movie.year)
          : "";
    out.push({
      title,
      subtitle,
      event,
      at: toMs(r.date),
      ...(kind === "sonarr" ? seriesArt(r.series, base) : movieArt(r.movie, base)),
    });
    if (out.length >= cap) break;
  }
  return out;
}

function mapHealth(raw: unknown): ArrHealthItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawHealth[])
    .filter((h) => typeof h.message === "string" && h.message !== "")
    .map(
      (h): ArrHealthItem => ({
        // A notice stays one (#491); anything else that isn't explicitly an
        // error reads as a warning.
        type: h.type === "error" || h.type === "notice" ? h.type : "warning",
        message: h.message as string,
      })
    )
    .slice(0, HEALTH_CAP);
}

// The detail page (#223) shows a fuller grab/import history than the glance
// card's five most-recent — a bigger page scanned, capped higher.
export const ARR_DETAIL_RECENT_CAP = 30;
const DETAIL_HISTORY_PAGE_SIZE = 60;

export async function getArrSnapshot(
  kind: ArrKind,
  cfg: ArrConfig,
  // The detail read pulls a deeper history; the glance snapshot stays lean.
  opts: { recentCap?: number; historyPageSize?: number; links?: boolean } = {}
): Promise<ArrSnapshot> {
  // Rows link into the service only on its own page (#522).
  const base = opts.links ? serviceBase(cfg.url) : undefined;
  const recentCap = opts.recentCap ?? ARR_RECENT_CAP;
  const historyPageSize = opts.historyPageSize ?? HISTORY_PAGE_SIZE;
  const now = Date.now();
  const start = encodeURIComponent(new Date(now).toISOString());
  const end = encodeURIComponent(
    new Date(now + UPCOMING_WINDOW_DAYS * 86_400_000).toISOString()
  );
  const calendarPath =
    kind === "sonarr"
      ? `/api/v3/calendar?start=${start}&end=${end}&includeSeries=true`
      : `/api/v3/calendar?start=${start}&end=${end}`;
  const historyPath =
    kind === "sonarr"
      ? `/api/v3/history?page=1&pageSize=${historyPageSize}&sortKey=date&sortDirection=descending&includeSeries=true&includeEpisode=true`
      : `/api/v3/history?page=1&pageSize=${historyPageSize}&sortKey=date&sortDirection=descending&includeMovie=true`;

  const [calR, histR, healthR] = await Promise.allSettled([
    arrJson<unknown>(kind, cfg, calendarPath),
    arrJson<RawHistoryPage>(kind, cfg, historyPath),
    arrJson<RawHealth[]>(kind, cfg, "/api/v3/health"),
  ]);
  // If every sub-request failed, the service is down or misconfigured (bad key,
  // unreachable host) — surface that as the card's error. If only some failed
  // (one flaky endpoint), show the sections that did load instead of blanking
  // the whole card.
  if (
    calR.status === "rejected" &&
    histR.status === "rejected" &&
    healthR.status === "rejected"
  ) {
    throw calR.reason;
  }
  const upcoming =
    calR.status === "fulfilled"
      ? kind === "sonarr"
        ? mapSonarrCalendar(calR.value, base)
        : mapRadarrCalendar(calR.value, base)
      : [];
  const recent =
    histR.status === "fulfilled" ? mapHistory(kind, histR.value, recentCap, base) : [];
  const health = healthR.status === "fulfilled" ? mapHealth(healthR.value) : [];
  return { upcoming, recent, health };
}

// --- The detail page's extras (#523): what's downloading, what's wanted
// and missing, and the room left on each root folder. ---

export type ArrQueueItem = {
  title: string;
  subtitle: string;
  // 0–1 of the download, or null when the client hasn't reported a size.
  progress: number | null;
  // "downloading", "paused", "queued", "completed", "warning", "failed".
  status: string;
  // Time left as the service words it ("00:12:30"), or null.
  timeLeft: string | null;
  size: number | null;
} & ArrArt;
export type ArrMissingItem = { title: string; subtitle: string; at: number | null } & ArrArt;
export type ArrDisk = { path: string; free: number; total: number | null };

export type ArrDetail = ArrSnapshot & {
  queue: ArrQueueItem[];
  queueTotal: number;
  missing: ArrMissingItem[];
  missingTotal: number;
  disks: ArrDisk[];
  // The service's own pages, for "Open in Sonarr" (#522).
  links: { home: string; queue: string; missing: string };
};

export const ARR_QUEUE_CAP = 20;
export const ARR_MISSING_CAP = 8;
const DISK_CAP = 8;

type RawPage<T> = { totalRecords?: number; records?: T[] };
type RawQueueRecord = {
  title?: string;
  status?: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  size?: number;
  sizeleft?: number;
  timeleft?: string;
  series?: RawSeries;
  episode?: { seasonNumber?: number; episodeNumber?: number };
  movie?: RawMovie;
};
type RawMissingRecord = {
  title?: string;
  airDateUtc?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  series?: RawSeries;
  year?: number;
  tmdbId?: number;
  images?: RawImage[];
  digitalRelease?: string;
  physicalRelease?: string;
  inCinemas?: string;
};
type RawDisk = { path?: string; freeSpace?: number; totalSpace?: number };

const records = <T,>(raw: unknown): T[] => {
  const page = (raw ?? {}) as RawPage<T>;
  return Array.isArray(page.records) ? page.records : [];
};
const total = (raw: unknown, fallback: number): number => {
  const n = ((raw ?? {}) as RawPage<unknown>).totalRecords;
  return typeof n === "number" && n >= 0 ? n : fallback;
};

export function mapQueue(kind: ArrKind, raw: unknown, base?: string): ArrQueueItem[] {
  return records<RawQueueRecord>(raw)
    .slice(0, ARR_QUEUE_CAP)
    .map((r): ArrQueueItem => {
      const size = typeof r.size === "number" && r.size > 0 ? r.size : null;
      const left = typeof r.sizeleft === "number" ? r.sizeleft : null;
      // The tracked status says when an import is stuck; the plain status
      // says what the download client is doing.
      const tracked = (r.trackedDownloadStatus ?? "").toLowerCase();
      const status = tracked === "warning" || tracked === "error" ? (tracked === "error" ? "failed" : "warning") : (r.status ?? "queued").toLowerCase();
      return {
        title:
          (kind === "sonarr" ? r.series?.title?.trim() : r.movie?.title?.trim()) || r.title?.trim() || "(unknown)",
        subtitle:
          kind === "sonarr"
            ? seasonEp(r.episode?.seasonNumber, r.episode?.episodeNumber)
            : r.movie?.year
              ? String(r.movie.year)
              : "",
        progress: size !== null && left !== null ? Math.min(1, Math.max(0, 1 - left / size)) : null,
        status,
        timeLeft: typeof r.timeleft === "string" && r.timeleft !== "" ? r.timeleft : null,
        size,
        ...(kind === "sonarr" ? seriesArt(r.series, base) : movieArt(r.movie, base)),
      };
    });
}

export function mapMissing(kind: ArrKind, raw: unknown, base?: string): ArrMissingItem[] {
  return records<RawMissingRecord>(raw)
    .slice(0, ARR_MISSING_CAP)
    .map((r): ArrMissingItem =>
      kind === "sonarr"
        ? {
            title: r.series?.title?.trim() || "(unknown series)",
            subtitle: seasonEp(r.seasonNumber, r.episodeNumber),
            at: toMs(r.airDateUtc),
            ...seriesArt(r.series, base),
          }
        : {
            title: r.title?.trim() || "(unknown movie)",
            subtitle: r.year ? String(r.year) : "",
            at: toMs(r.digitalRelease) ?? toMs(r.physicalRelease) ?? toMs(r.inCinemas),
            ...movieArt(r, base),
          }
    );
}

export function mapDisks(raw: unknown): ArrDisk[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawDisk[])
    .filter((d) => typeof d.path === "string" && d.path !== "" && typeof d.freeSpace === "number")
    .slice(0, DISK_CAP)
    .map((d) => ({
      path: d.path as string,
      free: d.freeSpace as number,
      total: typeof d.totalSpace === "number" && d.totalSpace > 0 ? d.totalSpace : null,
    }));
}

// The detail read: the snapshot with a deeper recent history and rows that
// link into the service, plus the queue, what's missing and the disks. Each
// extra is best effort: one that fails leaves its section empty.
export async function getArrDetail(kind: ArrKind, cfg: ArrConfig): Promise<ArrDetail> {
  const base = serviceBase(cfg.url);
  const include = kind === "sonarr" ? "includeSeries=true&includeEpisode=true" : "includeMovie=true";
  const [snapshot, queueR, missingR, diskR] = await Promise.all([
    getArrSnapshot(kind, cfg, {
      recentCap: ARR_DETAIL_RECENT_CAP,
      historyPageSize: DETAIL_HISTORY_PAGE_SIZE,
      links: true,
    }),
    ...[
      `/api/v3/queue?page=1&pageSize=${ARR_QUEUE_CAP}&${include}`,
      `/api/v3/wanted/missing?page=1&pageSize=${ARR_MISSING_CAP}&sortKey=${kind === "sonarr" ? "airDateUtc" : "digitalRelease"}&sortDirection=descending&monitored=true${kind === "sonarr" ? "&includeSeries=true" : ""}`,
      "/api/v3/diskspace",
    ].map((path) => arrJson<unknown>(kind, cfg, path).catch(() => null)),
  ]);
  const queue = mapQueue(kind, queueR, base);
  const missing = mapMissing(kind, missingR, base);
  return {
    ...snapshot,
    queue,
    queueTotal: total(queueR, queue.length),
    missing,
    missingTotal: total(missingR, missing.length),
    disks: mapDisks(diskR),
    links: { home: base, queue: `${base}/activity/queue`, missing: `${base}/wanted/missing` },
  };
}

// Fresh reachability check for the admin's "Test connection" button. The
// system/status endpoint requires the API key and names the app, so success
// proves both the key and that it's really a Sonarr/Radarr on the other end.
export async function probeArr(
  kind: ArrKind,
  cfg: ArrConfig
): Promise<ProbeResult> {
  return runProbe(kind, async () => {
    const status = await arrJson<{ appName?: string; version?: string }>(
      kind,
      cfg,
      "/api/v3/system/status"
    );
    const name =
      typeof status.appName === "string" && status.appName !== ""
        ? status.appName
        : kind === "sonarr"
          ? "Sonarr"
          : "Radarr";
    const version = typeof status.version === "string" ? ` ${status.version}` : "";
    return `${name}${version}`;
  });
}
