// Typed client for the Sonarr and Radarr v3 APIs (#191). One implementation —
// the two share nearly every shape — with small per-kind differences where the
// APIs genuinely diverge (episodes vs movies). Server-side only; the API key
// never reaches the browser.
//
// The card answers "what's coming to my library, and what just landed": the
// next couple of weeks of the calendar (upcoming episodes / movie releases),
// the most recent grabs and imports from history, and any health warnings.

import {
  ServiceError,
  serviceBase,
  serviceJson,
  runProbe,
  type ProbeResult,
} from "./http";

export type ArrKind = "sonarr" | "radarr";

export type ArrConfig = { url: string; apiKey: string };

// The API key can come from the environment instead of config.yaml, same
// convention as CTRLCENTER_SMTP_PASS / CTRLCENTER_CALDAV_PASS.
export function resolveArrApiKey(kind: ArrKind, cfg: { apiKey: string }): string {
  const env =
    kind === "sonarr"
      ? process.env.CTRLCENTER_SONARR_KEY
      : process.env.CTRLCENTER_RADARR_KEY;
  return env || cfg.apiKey;
}

// One row of the "upcoming" list: a series/movie title, a short qualifier
// (episode code, or the release kind for a movie), and when it airs/releases.
export type ArrUpcomingItem = {
  title: string;
  subtitle: string;
  // Air/release time (epoch ms), or null when the record had no usable date.
  at: number | null;
};

// One row of the "recent" list: something grabbed or imported, newest first.
export type ArrRecentItem = {
  title: string;
  subtitle: string;
  event: "grabbed" | "imported";
  // When the event happened (epoch ms), or null.
  at: number | null;
};

export type ArrHealthItem = { type: "warning" | "error"; message: string };

export type ArrSnapshot = {
  upcoming: ArrUpcomingItem[];
  recent: ArrRecentItem[];
  health: ArrHealthItem[];
};

export const ARR_UPCOMING_CAP = 6;
export const ARR_RECENT_CAP = 5;
const HEALTH_CAP = 5;
// How far ahead the "upcoming" window looks.
const UPCOMING_WINDOW_DAYS = 14;
// History page to scan before filtering down to grabs/imports (other event
// types — renames, deletions — are skipped).
const HISTORY_PAGE_SIZE = 25;

// --- Raw API shapes (only the fields the snapshot uses) ---

type RawCalendarEpisode = {
  airDateUtc?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  title?: string;
  series?: { title?: string };
};
type RawCalendarMovie = {
  title?: string;
  year?: number;
  inCinemas?: string;
  digitalRelease?: string;
  physicalRelease?: string;
};
type RawHistoryPage = { records?: RawHistoryRecord[] };
type RawHistoryRecord = {
  eventType?: string;
  date?: string;
  series?: { title?: string };
  episode?: { seasonNumber?: number; episodeNumber?: number };
  movie?: { title?: string; year?: number };
};
type RawHealth = { type?: string; message?: string };

async function arrJson<T>(
  kind: ArrKind,
  cfg: ArrConfig,
  path: string
): Promise<T> {
  const base = serviceBase(cfg.url);
  try {
    return await serviceJson<T>(`${base}${path}`, {
      headers: { "X-Api-Key": resolveArrApiKey(kind, cfg) },
    });
  } catch (e) {
    // 401 has exactly one meaning here; say it in the admin's terms.
    if (e instanceof ServiceError && e.message === "HTTP 401") {
      throw new ServiceError("Invalid API key");
    }
    throw e;
  }
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

export function mapSonarrCalendar(raw: unknown): ArrUpcomingItem[] {
  const arr = Array.isArray(raw) ? (raw as RawCalendarEpisode[]) : [];
  return arr
    .map(
      (e): ArrUpcomingItem => ({
        title: e.series?.title?.trim() || "(unknown series)",
        subtitle: seasonEp(e.seasonNumber, e.episodeNumber),
        at: toMs(e.airDateUtc),
      })
    )
    .sort(byAtAsc)
    .slice(0, ARR_UPCOMING_CAP);
}

export function mapRadarrCalendar(raw: unknown): ArrUpcomingItem[] {
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

export function mapHistory(kind: ArrKind, raw: unknown): ArrRecentItem[] {
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
    out.push({ title, subtitle, event, at: toMs(r.date) });
    if (out.length >= ARR_RECENT_CAP) break;
  }
  return out;
}

function mapHealth(raw: unknown): ArrHealthItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawHealth[])
    .filter((h) => typeof h.message === "string" && h.message !== "")
    .map(
      (h): ArrHealthItem => ({
        // Anything that isn't explicitly an error reads as a warning.
        type: h.type === "error" ? "error" : "warning",
        message: h.message as string,
      })
    )
    .slice(0, HEALTH_CAP);
}

export async function getArrSnapshot(
  kind: ArrKind,
  cfg: ArrConfig
): Promise<ArrSnapshot> {
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
      ? `/api/v3/history?page=1&pageSize=${HISTORY_PAGE_SIZE}&sortKey=date&sortDirection=descending&includeSeries=true&includeEpisode=true`
      : `/api/v3/history?page=1&pageSize=${HISTORY_PAGE_SIZE}&sortKey=date&sortDirection=descending&includeMovie=true`;

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
        ? mapSonarrCalendar(calR.value)
        : mapRadarrCalendar(calR.value)
      : [];
  const recent = histR.status === "fulfilled" ? mapHistory(kind, histR.value) : [];
  const health = healthR.status === "fulfilled" ? mapHealth(healthR.value) : [];
  return { upcoming, recent, health };
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
