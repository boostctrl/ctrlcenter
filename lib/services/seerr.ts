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
  serviceBase,
  serviceRequest,
  parseJson,
  throwForStatus,
  runProbe,
  type ProbeResult,
} from "./http";

export type SeerrConfig = { url: string; apiKey: string };

// A request's standing: its approval state, or — once approved — how far the
// media has progressed toward being available.
export type SeerrRequestStatus =
  | "pending"
  | "declined"
  | "approved"
  | "processing"
  | "available";

export type SeerrRequest = {
  // The request's id — what the approve/decline actions target (#202). A row
  // is actionable only while it's pending.
  id: number;
  title: string;
  requester: string;
  type: "movie" | "tv";
  status: SeerrRequestStatus;
  // When the request was made (epoch ms), or null.
  at: number | null;
  // On the page only (#522): the title's poster, and its page in Seerr.
  poster?: string;
  href?: string;
};

export type SeerrSnapshot = {
  pending: number;
  processing: number;
  available: number;
  totalRequests: number;
  requests: SeerrRequest[];
};

export const SEERR_REQUEST_CAP = 6;

// The page's read (#511): the requests waiting for approval, which are what
// ask something of the admin, and a longer run of the latest.
export type SeerrDetail = SeerrSnapshot & { waiting: SeerrRequest[] };
export const SEERR_DETAIL_RECENT = 15;
export const SEERR_DETAIL_WAITING = 20;

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
  id?: number;
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
    id: typeof raw.id === "number" ? raw.id : 0,
    title,
    requester: requester(raw),
    type: raw.type === "tv" ? "tv" : "movie",
    status: requestStatus(raw),
    at: toMs(raw.createdAt),
  };
}

// Seerr answers 403 to a bad API key.
const KEY_ERRORS = { 403: "Invalid API key" };

async function seerrJson<T>(cfg: SeerrConfig, path: string): Promise<T> {
  const base = serviceBase(cfg.url);
  const { res, text } = await serviceRequest(`${base}${path}`, {
    headers: { "X-Api-Key": cfg.apiKey },
  });
  throwForStatus(res, KEY_ERRORS);
  return parseJson<T>(text);
}

// Resolve a request's media title (and its poster, #522) from its tmdbId.
// Best-effort: a failed or title-less lookup falls back to a stable
// placeholder, never failing the whole snapshot over one unresolved item.
async function resolveMedia(cfg: SeerrConfig, raw: RawRequest): Promise<{ title: string; poster?: string }> {
  const tmdbId = raw.media?.tmdbId;
  const type = raw.type === "tv" ? "tv" : "movie";
  if (typeof tmdbId !== "number") {
    return { title: type === "tv" ? "TV request" : "Movie request" };
  }
  try {
    const detail = await seerrJson<{ title?: string; name?: string; posterPath?: string }>(
      cfg,
      `/api/v1/${type}/${tmdbId}`
    );
    // Movies report `title`, TV reports `name`.
    const name = (detail.title ?? detail.name ?? "").trim();
    // TMDB's public artwork, at a row's size.
    const path = typeof detail.posterPath === "string" && /^\/[\w.-]+$/.test(detail.posterPath) ? detail.posterPath : "";
    if (name) return { title: name, ...(path ? { poster: `https://image.tmdb.org/t/p/w154${path}` } : {}) };
  } catch {
    // fall through to the placeholder
  }
  return { title: `${type === "tv" ? "TV" : "Movie"} #${tmdbId}` };
}
const resolveTitle = async (cfg: SeerrConfig, raw: RawRequest) => (await resolveMedia(cfg, raw)).title;

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

// The page's read (#511). One title lookup per media, however many of the
// requests shown name it.
export async function getSeerrDetail(cfg: SeerrConfig): Promise<SeerrDetail> {
  const [count, page, pending] = await Promise.all([
    seerrJson<RawCount>(cfg, "/api/v1/request/count"),
    seerrJson<RawRequestPage>(cfg, `/api/v1/request?take=${SEERR_DETAIL_RECENT}&skip=0&sort=added`),
    seerrJson<RawRequestPage>(
      cfg,
      `/api/v1/request?take=${SEERR_DETAIL_WAITING}&skip=0&sort=added&filter=pending`
    ),
  ]);
  const base = serviceBase(cfg.url);
  const media = new Map<string, Promise<{ title: string; poster?: string }>>();
  const mediaOf = (raw: RawRequest) => {
    const key = `${raw.type === "tv" ? "tv" : "movie"}:${raw.media?.tmdbId ?? `request-${raw.id}`}`;
    let found = media.get(key);
    if (!found) media.set(key, (found = resolveMedia(cfg, raw)));
    return found;
  };
  const rows = (p: RawRequestPage) => (Array.isArray(p.results) ? p.results : []);
  // Each row with its poster and its page in Seerr.
  const map = (list: RawRequest[]) =>
    Promise.all(
      list.map(async (raw) => {
        const { title, poster } = await mediaOf(raw);
        const tmdbId = raw.media?.tmdbId;
        return {
          ...mapSeerrRequest(raw, title),
          ...(poster ? { poster } : {}),
          ...(typeof tmdbId === "number" ? { href: `${base}/${raw.type === "tv" ? "tv" : "movie"}/${tmdbId}` } : {}),
        };
      })
    );
  const [requests, waiting] = await Promise.all([
    map(rows(page)),
    // Seerr's filter decides what's pending; the status check keeps a
    // version that ignores the filter from listing everything here.
    map(rows(pending).filter((raw) => requestStatus(raw) === "pending")),
  ]);
  return {
    pending: num(count.pending),
    processing: num(count.processing),
    available: num(count.available),
    totalRequests: num(count.total),
    requests,
    waiting,
  };
}

// --- Write actions (#202) ---
//
// Approve or decline a pending request. Both are keyed POSTs to the request's
// own endpoint; Seerr answers with the updated request, which the card doesn't
// need — a 2xx is success. Reachable only through the admin-gated
// /api/monitor/action route, behind the allowActions opt-in.
async function seerrAction(cfg: SeerrConfig, path: string): Promise<void> {
  const base = serviceBase(cfg.url);
  const { res } = await serviceRequest(`${base}${path}`, {
    method: "POST",
    headers: { "X-Api-Key": cfg.apiKey },
  });
  throwForStatus(res, KEY_ERRORS);
}

export function approveRequest(cfg: SeerrConfig, id: number): Promise<void> {
  return seerrAction(cfg, `/api/v1/request/${id}/approve`);
}

export function declineRequest(cfg: SeerrConfig, id: number): Promise<void> {
  return seerrAction(cfg, `/api/v1/request/${id}/decline`);
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
