// Typed client for the Overseerr / Jellyseerr API (#196). They share one API,
// so one client covers both. Server-side only — calls happen inside
// admin-gated routes via the monitor cache, and the API key never reaches the
// browser. Overseerr authenticates with an `X-Api-Key` header.
//
// The card answers "what's waiting on me to approve": the pending-request
// count and a capped list of the most recent requests, each with its title,
// who asked, and where it stands. A request payload carries only the media's
// tmdbId, not its title, so each shown request's title is resolved with a
// follow-up movie/tv lookup (bounded by the list cap, failures tolerated).

import {
  ServiceError,
  serviceBase,
  serviceJson,
  runProbe,
  type ProbeResult,
} from "./http";
import { resolveSecret } from "../secrets";

export type OverseerrConfig = { url: string; apiKey: string };

// The API key can come from the environment instead of config.yaml, same
// convention as the other integrations.
export function resolveOverseerrApiKey(cfg: { apiKey: string }): string {
  return resolveSecret("CTRLCENTER_OVERSEERR_KEY", cfg.apiKey);
}

// A request's standing: its approval state, or — once approved — how far the
// media has progressed toward being available.
export type OverseerrRequestStatus =
  | "pending"
  | "declined"
  | "approved"
  | "processing"
  | "available";

export type OverseerrRequest = {
  title: string;
  requester: string;
  type: "movie" | "tv";
  status: OverseerrRequestStatus;
  // When the request was made (epoch ms), or null.
  at: number | null;
};

export type OverseerrSnapshot = {
  pending: number;
  processing: number;
  available: number;
  totalRequests: number;
  requests: OverseerrRequest[];
};

export const OVERSEERR_REQUEST_CAP = 6;

// --- Raw API shapes (only the fields the snapshot uses) ---

type RawCount = {
  pending?: number;
  approved?: number;
  processing?: number;
  available?: number;
  total?: number;
};
type RawRequestPage = { results?: RawRequest[] };
type RawRequest = {
  // 1 = pending approval, 2 = approved, 3 = declined.
  status?: number;
  type?: string;
  createdAt?: string;
  media?: {
    tmdbId?: number;
    mediaType?: string;
    // 2 = pending, 3 = processing, 4 = partially available, 5 = available.
    status?: number;
  };
  requestedBy?: {
    displayName?: string;
    username?: string;
    plexUsername?: string;
  };
};

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
const toMs = (s?: string): number | null => {
  if (typeof s !== "string" || s === "") return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
};

// Combine the request's approval state with the media's availability into the
// single status the card shows: a declined/pending request reads as such; an
// approved one reflects how far the download has progressed.
export function requestStatus(raw: RawRequest): OverseerrRequestStatus {
  if (raw.status === 3) return "declined";
  if (raw.status === 1) return "pending";
  // Approved (or an unexpected code): defer to the media's progress.
  const media = raw.media?.status;
  if (media === 5) return "available";
  if (media === 4 || media === 3) return "processing";
  return "approved";
}

function requester(raw: RawRequest): string {
  const u = raw.requestedBy;
  return (
    u?.displayName?.trim() ||
    u?.plexUsername?.trim() ||
    u?.username?.trim() ||
    "(unknown)"
  );
}

// Exported for the unit tests: fold one raw request + its resolved title into
// the card's row shape.
export function mapOverseerrRequest(
  raw: RawRequest,
  title: string
): OverseerrRequest {
  return {
    title,
    requester: requester(raw),
    type: raw.type === "tv" ? "tv" : "movie",
    status: requestStatus(raw),
    at: toMs(raw.createdAt),
  };
}

async function overseerrJson<T>(cfg: OverseerrConfig, path: string): Promise<T> {
  const base = serviceBase(cfg.url);
  try {
    return await serviceJson<T>(`${base}${path}`, {
      headers: { "X-Api-Key": resolveOverseerrApiKey(cfg) },
    });
  } catch (e) {
    if (e instanceof ServiceError && e.message === "HTTP 403") {
      throw new ServiceError("Invalid API key");
    }
    throw e;
  }
}

// Resolve a request's media title from its tmdbId. Best-effort: a failed or
// title-less lookup falls back to a stable placeholder, never failing the
// whole snapshot over one unresolved item.
async function resolveTitle(
  cfg: OverseerrConfig,
  raw: RawRequest
): Promise<string> {
  const tmdbId = raw.media?.tmdbId;
  const type = raw.type === "tv" ? "tv" : "movie";
  if (typeof tmdbId !== "number") {
    return type === "tv" ? "TV request" : "Movie request";
  }
  try {
    const detail = await overseerrJson<{ title?: string; name?: string }>(
      cfg,
      `/api/v1/${type}/${tmdbId}`
    );
    // Movies report `title`, TV reports `name`.
    const name = (detail.title ?? detail.name ?? "").trim();
    if (name) return name;
  } catch {
    // fall through to the placeholder
  }
  return `${type === "tv" ? "TV" : "Movie"} #${tmdbId}`;
}

export async function getOverseerrSnapshot(
  cfg: OverseerrConfig
): Promise<OverseerrSnapshot> {
  const [count, page] = await Promise.all([
    overseerrJson<RawCount>(cfg, "/api/v1/request/count"),
    overseerrJson<RawRequestPage>(
      cfg,
      `/api/v1/request?take=${OVERSEERR_REQUEST_CAP}&skip=0&sort=added`
    ),
  ]);
  const rows = Array.isArray(page.results) ? page.results : [];
  const requests = await Promise.all(
    rows.map(async (raw) => mapOverseerrRequest(raw, await resolveTitle(cfg, raw)))
  );
  return {
    pending: num(count.pending),
    processing: num(count.processing),
    available: num(count.available),
    totalRequests: num(count.total),
    requests,
  };
}

// Fresh reachability check for the admin's "Test connection" button. The
// /status endpoint needs the key and names the version, so success proves
// both the key and that Overseerr/Jellyseerr is on the other end.
export async function probeOverseerr(
  cfg: OverseerrConfig
): Promise<ProbeResult> {
  return runProbe("overseerr", async () => {
    const status = await overseerrJson<{ version?: string }>(
      cfg,
      "/api/v1/status"
    );
    const version =
      typeof status.version === "string" && status.version !== ""
        ? ` ${status.version}`
        : "";
    return `Overseerr${version}`;
  });
}
