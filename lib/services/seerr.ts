// Typed client for the Seerr API (#196). Seerr is the unified successor to
// Overseerr and Jellyseerr (the two projects merged in 2026); it keeps their
// `/api/v1` API and `X-Api-Key` auth, so one client covers a Seerr instance
// migrated from either. Server-side only — calls happen inside admin-gated
// routes via the monitor cache, and the API key never reaches the browser.
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

export type SeerrConfig = { url: string; apiKey: string };

// The API key can come from the environment instead of config.yaml, same
// convention as the other integrations.
export function resolveSeerrApiKey(cfg: { apiKey: string }): string {
  return resolveSecret("CTRLCENTER_SEERR_KEY", cfg.apiKey);
}

// A request's standing: its approval state, or — once approved — how far the
// media has progressed toward being available.
export type SeerrRequestStatus =
  | "pending"
  | "declined"
  | "approved"
  | "processing"
  | "available";

export type SeerrRequest = {
  title: string;
  requester: string;
  type: "movie" | "tv";
  status: SeerrRequestStatus;
  // When the request was made (epoch ms), or null.
  at: number | null;
};

export type SeerrSnapshot = {
  pending: number;
  processing: number;
  available: number;
  totalRequests: number;
  requests: SeerrRequest[];
};

export const SEERR_REQUEST_CAP = 6;

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
export function requestStatus(raw: RawRequest): SeerrRequestStatus {
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
export function mapSeerrRequest(raw: RawRequest, title: string): SeerrRequest {
  return {
    title,
    requester: requester(raw),
    type: raw.type === "tv" ? "tv" : "movie",
    status: requestStatus(raw),
    at: toMs(raw.createdAt),
  };
}

async function seerrJson<T>(cfg: SeerrConfig, path: string): Promise<T> {
  const base = serviceBase(cfg.url);
  try {
    return await serviceJson<T>(`${base}${path}`, {
      headers: { "X-Api-Key": resolveSeerrApiKey(cfg) },
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
async function resolveTitle(cfg: SeerrConfig, raw: RawRequest): Promise<string> {
  const tmdbId = raw.media?.tmdbId;
  const type = raw.type === "tv" ? "tv" : "movie";
  if (typeof tmdbId !== "number") {
    return type === "tv" ? "TV request" : "Movie request";
  }
  try {
    const detail = await seerrJson<{ title?: string; name?: string }>(
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

export async function getSeerrSnapshot(cfg: SeerrConfig): Promise<SeerrSnapshot> {
  const [count, page] = await Promise.all([
    seerrJson<RawCount>(cfg, "/api/v1/request/count"),
    seerrJson<RawRequestPage>(
      cfg,
      `/api/v1/request?take=${SEERR_REQUEST_CAP}&skip=0&sort=added`
    ),
  ]);
  const rows = Array.isArray(page.results) ? page.results : [];
  const requests = await Promise.all(
    rows.map(async (raw) => mapSeerrRequest(raw, await resolveTitle(cfg, raw)))
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
// both the key and that Seerr is on the other end.
export async function probeSeerr(cfg: SeerrConfig): Promise<ProbeResult> {
  return runProbe("seerr", async () => {
    const status = await seerrJson<{ version?: string }>(cfg, "/api/v1/status");
    const version =
      typeof status.version === "string" && status.version !== ""
        ? ` ${status.version}`
        : "";
    return `Seerr${version}`;
  });
}
