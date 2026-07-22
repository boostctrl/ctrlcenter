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
import { resolveSecret } from "../secrets";

export type TautulliConfig = { url: string; apiKey: string };

// The API key can come from the environment instead of config.yaml, same
// convention as the other integrations.
export function resolveTautulliApiKey(cfg: { apiKey: string }): string {
  return resolveSecret("CTRLCENTER_TAUTULLI_KEY", cfg.apiKey);
}

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
};

export type TautulliSnapshot = {
  streamCount: number;
  transcodeCount: number;
  // Total streaming bandwidth in kbps; null when Tautulli doesn't report it.
  totalBandwidthKbps: number | null;
  sessions: TautulliSession[];
};

export const TAUTULLI_SESSION_CAP = 6;

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

async function tautulliCmd<T>(cfg: TautulliConfig, cmd: string): Promise<T> {
  const base = serviceBase(cfg.url);
  const key = encodeURIComponent(resolveTautulliApiKey(cfg));
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
