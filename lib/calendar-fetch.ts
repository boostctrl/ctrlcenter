// Server-side calendar fetching: the time-boxed, size-capped, cached ICS fetch
// behind the home-page agenda and the /calendar page, plus the admin "Test"
// probe. Split from lib/calendar.ts (pure parsing and display helpers) so the
// client components that format events never import network or secret code.
import {
  DAY_MS,
  RECUR_WINDOW_MS,
  expandRecurring,
  parseICS,
  upcomingEvents,
  type CalendarEvent,
} from "./calendar";
import { readCapped, fetchWithTimeout } from "./fetch-body";
import { log, hostOf, errorReason } from "./log";
import { resolveSecret } from "./secrets";
import { globalSingleton } from "./singleton";

const CAL_TIMEOUT_MS = 6000;
const CAL_CACHE_TTL_MS = 5 * 60_000;
// Cap the fetched body so a huge or malicious feed can't exhaust server memory —
// the fetch is reachable from anonymous home-page loads. Generous for ICS (real
// feeds are well under 1 MB).
const CAL_MAX_BYTES = 5 * 1024 * 1024;

// Parsed-event cache keyed by URL, so the homepage (force-dynamic) doesn't make
// a blocking third-party request on every render. Held on globalThis to survive
// module-graph duplication, like the status-history store. A companion map
// dedupes in-flight background refreshes so a stale entry triggers at most one
// refetch per URL however many renders want it (the same shape lib/feed.ts uses).
type CalCacheEntry = { events: CalendarEvent[]; at: number };
const calCache = globalSingleton(
  "__ctrlcenterCalCache",
  () => new Map<string, CalCacheEntry>()
);
const calRefreshInFlight = globalSingleton(
  "__ctrlcenterCalRefresh",
  () => new Map<string, Promise<void>>()
);

export type CalendarAuth = { username?: string; password?: string };

// Build the request headers, attaching Basic auth for a private calendar. The
// password may come from CTRLCENTER_CALDAV_PASS to keep it out of config.yaml.
function calendarHeaders(auth?: CalendarAuth): Record<string, string> {
  const headers: Record<string, string> = { Accept: "text/calendar, */*" };
  const user = auth?.username?.trim();
  if (user) {
    const pass = resolveSecret("CTRLCENTER_CALDAV_PASS", auth?.password ?? "");
    headers.Authorization =
      "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  }
  return headers;
}

// GET a URL (time-boxed, size-capped) and return its ICS body, or a short reason
// it isn't usable — so callers can tell "served ICS" from a WebDAV collection /
// HTTP error / oversized body, and surface that to the admin.
async function getIcs(
  target: string,
  headers: HeadersInit
): Promise<{ text: string | null; error: string | null }> {
  try {
    const res = await fetchWithTimeout(target, { headers }, CAL_TIMEOUT_MS);
    if (!res.ok) return { text: null, error: `HTTP ${res.status}` };
    const text = await readCapped(res, CAL_MAX_BYTES);
    if (text === null) return { text: null, error: "Response too large" };
    if (!text.includes("BEGIN:VCALENDAR"))
      return { text: null, error: "Not an iCalendar feed" };
    return { text, error: null };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    log.warn("calendar fetch error", { host: hostOf(target), reason: errorReason(e) });
    return { text: null, error: aborted ? "Timed out" : "Couldn't connect" };
  }
}

// Request a calendar's ICS. A plain GET handles published .ics feeds; if that
// doesn't return ICS (a CalDAV/WebDAV *collection* URL serves an XML/HTML
// listing instead), retry with `?export`, which Nextcloud/ownCloud/Radicale/
// Baikal use to emit the collection as a single ICS. Keeps the first error if
// both attempts fail (usually the more informative one).
async function requestIcs(
  target: string,
  headers: HeadersInit
): Promise<{ text: string | null; error: string | null }> {
  const first = await getIcs(target, headers);
  if (first.text || /[?&]export(=|&|$)/i.test(target)) return first;
  const sep = target.includes("?") ? "&" : "?";
  const second = await getIcs(`${target}${sep}export`, headers);
  return second.text ? second : first;
}

// Refresh one calendar URL's cache entry, deduped so at most one fetch per URL
// is in flight however many renders want it. Only a successful ICS parse
// replaces the entry — a fetch/parse failure keeps serving the last good cache
// (stale-on-failure). Never rejects (requestIcs never throws), so a
// fire-and-forget call can't become an unhandled rejection.
function refreshCalendar(target: string, auth?: CalendarAuth): Promise<void> {
  const inFlight = calRefreshInFlight.get(target);
  if (inFlight) return inFlight;
  const run = (async () => {
    try {
      const { text } = await requestIcs(target, calendarHeaders(auth));
      if (text) calCache.set(target, { events: parseICS(text), at: Date.now() });
      // On failure, keep the last good cache (leave the entry untouched).
    } finally {
      calRefreshInFlight.delete(target);
    }
  })();
  calRefreshInFlight.set(target, run);
  return run;
}

// Fetch + parse a calendar's raw (unexpanded) VEVENTs, cached for a few minutes
// so repeated home/calendar renders don't each hit the third-party feed. Returns
// [] for a non-http(s) URL; on a fetch/parse failure serves the last good cache
// if there is one, else []. Never throws. `webcal://` URLs are normalized to
// https. Shared by fetchCalendar (upcoming) and fetchCalendarRange (month grid).
//
// Stale-while-revalidate: an existing entry — even one past its TTL — is served
// immediately with the refetch running behind the response; only a cold cache
// blocks the render on the third-party fetch (previously every lapsed TTL did).
async function loadParsedEvents(
  url: string,
  auth?: CalendarAuth
): Promise<CalendarEvent[]> {
  const target = url.trim().replace(/^webcal:\/\//i, "https://");
  if (!/^https?:\/\//i.test(target)) return [];
  const cached = calCache.get(target);
  if (!cached) {
    await refreshCalendar(target, auth);
  } else if (Date.now() - cached.at >= CAL_CACHE_TTL_MS) {
    void refreshCalendar(target, auth);
  }
  return (calCache.get(target) ?? cached)?.events ?? [];
}

// The next `count` upcoming events (recurring series expanded over the near
// window). Best-effort; never throws.
export async function fetchCalendar(
  url: string,
  count = 5,
  auth?: CalendarAuth
): Promise<CalendarEvent[]> {
  const now = Date.now();
  const events = await loadParsedEvents(url, auth);
  const expanded = expandRecurring(events, now, now + RECUR_WINDOW_MS);
  return upcomingEvents(expanded, now, count);
}

// Every event overlapping [from, to] — past and future, no count cap — sorted by
// start. For the month grid, which shows a whole month rather than only what's
// next. Recurring series are expanded across the range. Best-effort; never throws.
export async function fetchCalendarRange(
  url: string,
  from: number,
  to: number,
  auth?: CalendarAuth
): Promise<CalendarEvent[]> {
  const events = await loadParsedEvents(url, auth);
  const expanded = expandRecurring(events, from, to);
  return expanded
    .filter(
      (e) => (e.end ?? (e.allDay ? e.start + DAY_MS : e.start)) > from && e.start < to
    )
    .sort((a, b) => a.start - b.start);
}

// Fresh (uncached) reachability check for the admin: does the URL serve a parsable
// calendar, and how many upcoming events does it have? Returns a short error
// otherwise. Never throws.
export async function probeCalendar(
  url: string,
  auth?: CalendarAuth
): Promise<{ ok: boolean; count: number; error?: string }> {
  const target = url.trim().replace(/^webcal:\/\//i, "https://");
  if (!/^https?:\/\//i.test(target)) {
    return { ok: false, count: 0, error: "URL must start with http(s) or webcal" };
  }
  const { text, error } = await requestIcs(target, calendarHeaders(auth));
  if (!text) return { ok: false, count: 0, error: error ?? "Fetch failed" };
  const now = Date.now();
  const upcoming = upcomingEvents(
    expandRecurring(parseICS(text), now, now + RECUR_WINDOW_MS),
    now,
    100
  );
  return { ok: true, count: upcoming.length };
}
