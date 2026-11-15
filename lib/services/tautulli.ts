// Typed client for the Tautulli v2 API (#195). Server-side only — calls
// happen inside admin-gated routes via the monitor cache, and the API key
// never reaches the browser. Tautulli takes the key as an `apikey` query
// parameter and answers every command on one endpoint (/api/v2?cmd=…);
// errors come back as HTTP 200 with response.result = "error".
//
// The card answers "who's watching Plex right now": stream count, total
// bandwidth, and a capped list of sessions with progress and whether each
// one is direct play or a transcode.

import {
  ServiceError,
  serviceBase,
  serviceJson,
  runProbe,
  type ProbeResult,
} from "./http";

export type TautulliConfig = { url: string; apiKey: string };

export type TautulliSession = {
  user: string;
  title: string;
  state: "playing" | "paused" | "buffering";
  // Direct play and direct stream both count as "direct" — the interesting
  // signal is whether the server is burning CPU on a transcode.
  playback: "direct" | "transcode";
  // Completion 0..100.
  progress: number;
  quality: string;
  // The device and app playing it, and whether it's outside the network.
  player: string;
  remote: boolean;
};

export type TautulliSnapshot = {
  streamCount: number;
  transcodeCount: number;
  // Total streaming bandwidth in kbps; null when Tautulli doesn't report it.
  totalBandwidthKbps: number | null;
  sessions: TautulliSession[];
};

export const TAUTULLI_SESSION_CAP = 6;

// One row of recent watch history (the detail page, #223): who watched what and
// when, and whether it was a transcode.
export type TautulliHistoryItem = {
  user: string;
  title: string;
  // When it was watched (epoch ms), or null when Tautulli omitted the date.
  at: number | null;
  playback: "direct" | "transcode";
};

// The detail payload: the live activity snapshot plus a page of recent history.
export type TautulliDetail = TautulliSnapshot & {
  history: TautulliHistoryItem[];
  // The last 30 days in numbers, each list empty when Tautulli didn't
  // answer for it (#525).
  stats: TautulliStats;
};
export type TautulliStats = {
  topUsers: { name: string; plays: number; seconds: number }[];
  platforms: { name: string; plays: number }[];
  libraries: { name: string; kind: string; count: number }[];
  // Plays per day over the last two weeks, oldest first.
  playsByDay: { day: string; tv: number; movies: number; music: number }[];
};
export const TAUTULLI_STATS_DAYS = 30;
const STAT_ROWS = 5;

// How many recent history rows the detail page pulls.
export const TAUTULLI_HISTORY_CAP = 15;

// --- Raw API shapes (only the fields the snapshot uses). Tautulli reports
// most numbers as strings ("2", "42.5"), so everything goes through num(). ---

type RawEnvelope<T> = {
  response?: { result?: string; message?: string | null; data?: T };
};
type RawActivity = {
  stream_count?: unknown;
  total_bandwidth?: unknown;
  sessions?: RawSession[];
};
type RawSession = {
  friendly_name?: string;
  user?: string;
  full_title?: string;
  state?: string;
  transcode_decision?: string;
  progress_percent?: unknown;
  quality_profile?: string;
  player?: string;
  platform?: string;
  location?: string;
};
type RawHistory = { data?: RawHistoryRow[] };
type RawHistoryRow = {
  friendly_name?: string;
  user?: string;
  full_title?: string;
  // Tautulli returns the watch time as a unix timestamp in seconds.
  date?: unknown;
  transcode_decision?: string;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

// Exported for the unit tests: fold get_activity's data into the snapshot.
export function mapTautulliActivity(raw: unknown): TautulliSnapshot {
  const data = (raw ?? {}) as RawActivity;
  const rows = Array.isArray(data.sessions) ? data.sessions : [];
  const sessions = rows.slice(0, TAUTULLI_SESSION_CAP).map(
    (s): TautulliSession => ({
      user: s.friendly_name?.trim() || s.user?.trim() || "(unknown)",
      title: s.full_title?.trim() || "(unknown)",
      state:
        s.state === "paused"
          ? "paused"
          : s.state === "buffering"
            ? "buffering"
            : "playing",
      playback: s.transcode_decision === "transcode" ? "transcode" : "direct",
      progress: Math.min(100, Math.max(0, num(s.progress_percent) ?? 0)),
      quality: s.quality_profile?.trim() || "",
      player: [s.player?.trim(), s.platform?.trim()].filter(Boolean).join(" · ").slice(0, 80),
      remote: s.location === "wan",
    })
  );
  return {
    streamCount: num(data.stream_count) ?? rows.length,
    transcodeCount: rows.filter((s) => s.transcode_decision === "transcode")
      .length,
    totalBandwidthKbps: num(data.total_bandwidth),
    sessions,
  };
}

// Exported for the unit tests: fold get_history's data into history rows.
export function mapTautulliHistory(raw: unknown): TautulliHistoryItem[] {
  const rows = Array.isArray((raw as RawHistory)?.data)
    ? ((raw as RawHistory).data as RawHistoryRow[])
    : [];
  return rows.slice(0, TAUTULLI_HISTORY_CAP).map((r): TautulliHistoryItem => {
    const secs = num(r.date);
    return {
      user: r.friendly_name?.trim() || r.user?.trim() || "(unknown)",
      title: r.full_title?.trim() || "(unknown)",
      at: secs !== null ? secs * 1000 : null,
      playback: r.transcode_decision === "transcode" ? "transcode" : "direct",
    };
  });
}

// Exported for the unit tests: fold get_home_stats, get_libraries and
// get_plays_by_date into the page's numbers. Anything missing is empty.
export function mapTautulliStats(home: unknown, libraries: unknown, plays: unknown): TautulliStats {
  const stat = (id: string): Record<string, unknown>[] => {
    const hit = Array.isArray(home) ? (home as { stat_id?: string; rows?: unknown }[]).find((s) => s?.stat_id === id) : null;
    return Array.isArray(hit?.rows) ? (hit.rows as Record<string, unknown>[]) : [];
  };
  const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 80) : "");
  const series = (name: string): number[] => {
    const all = (plays as { series?: { name?: string; data?: unknown }[] } | null)?.series;
    const hit = Array.isArray(all) ? all.find((x) => x?.name === name) : null;
    return Array.isArray(hit?.data) ? (hit.data as unknown[]).map((v) => num(v) ?? 0) : [];
  };
  const days = (plays as { categories?: unknown } | null)?.categories;
  const [tv, movies, music] = [series("TV"), series("Movies"), series("Music")];
  return {
    topUsers: stat("top_users")
      .slice(0, STAT_ROWS)
      .map((r) => ({
        name: text(r.friendly_name) || text(r.user) || "(unknown)",
        plays: num(r.total_plays) ?? 0,
        seconds: num(r.total_duration) ?? 0,
      })),
    platforms: stat("top_platforms")
      .slice(0, STAT_ROWS)
      .map((r) => ({ name: text(r.platform) || "(unknown)", plays: num(r.total_plays) ?? 0 })),
    libraries: (Array.isArray(libraries) ? (libraries as Record<string, unknown>[]) : [])
      .slice(0, 12)
      .map((l) => ({ name: text(l.section_name) || "(unnamed)", kind: text(l.section_type), count: num(l.count) ?? 0 })),
    playsByDay: (Array.isArray(days) ? (days as unknown[]) : []).slice(-14).map((d, i, kept) => {
      const at = (xs: number[]) => xs[xs.length - kept.length + i] ?? 0;
      return { day: text(d), tv: at(tv), movies: at(movies), music: at(music) };
    }),
  };
}

async function tautulliCmd<T>(cfg: TautulliConfig, cmd: string): Promise<T> {
  const base = serviceBase(cfg.url);
  const key = encodeURIComponent(cfg.apiKey);
  const envelope = await serviceJson<RawEnvelope<T>>(
    `${base}/api/v2?apikey=${key}&cmd=${cmd}`
  );
  const response = envelope.response;
  if (!response || response.result !== "success") {
    const message = response?.message ?? "";
    // Tautulli answers 200 for a bad key, with the failure in the body.
    if (/apikey|api key/i.test(message)) {
      throw new ServiceError("Invalid API key");
    }
    throw new ServiceError("Tautulli reported an error");
  }
  return (response.data ?? {}) as T;
}

export async function getTautulliSnapshot(
  cfg: TautulliConfig
): Promise<TautulliSnapshot> {
  return mapTautulliActivity(await tautulliCmd<RawActivity>(cfg, "get_activity"));
}

// The detail read (#223): live activity plus a page of recent watch history.
// A failed history fetch degrades to an empty list rather than blanking the
// page — the live activity is the more important half.
export async function getTautulliDetail(
  cfg: TautulliConfig
): Promise<TautulliDetail> {
  const quiet = <T,>(cmd: string) => tautulliCmd<T>(cfg, cmd).catch(() => null);
  const [activity, history, home, libraries, plays] = await Promise.allSettled([
    tautulliCmd<RawActivity>(cfg, "get_activity"),
    tautulliCmd<RawHistory>(
      cfg,
      `get_history&length=${TAUTULLI_HISTORY_CAP}&order_column=date&order_dir=desc`
    ),
    quiet<unknown>(`get_home_stats&time_range=${TAUTULLI_STATS_DAYS}&stats_count=${STAT_ROWS}`),
    quiet<unknown>("get_libraries"),
    quiet<unknown>("get_plays_by_date&time_range=14"),
  ]);
  const settled = (r: PromiseSettledResult<unknown>) => (r.status === "fulfilled" ? r.value : null);
  // If even the activity read failed, the service is down — surface that.
  if (activity.status === "rejected") throw activity.reason;
  return {
    ...mapTautulliActivity(activity.value),
    history:
      history.status === "fulfilled" ? mapTautulliHistory(history.value) : [],
    stats: mapTautulliStats(settled(home), settled(libraries), settled(plays)),
  };
}

// Fresh reachability check for the admin's "Test connection" button: a
// key-authenticated command that names the Tautulli version, so success
// proves both the key and what's on the other end.
export async function probeTautulli(cfg: TautulliConfig): Promise<ProbeResult> {
  return runProbe("tautulli", async () => {
    const info = await tautulliCmd<{ tautulli_version?: string }>(
      cfg,
      "get_tautulli_info"
    );
    const version =
      typeof info.tautulli_version === "string" && info.tautulli_version !== ""
        ? ` ${info.tautulli_version}`
        : "";
    return `Tautulli${version}`;
  });
}
