import { isValidTimeZone } from "./datetime";

// Minimal iCalendar (RFC 5545) reader for the agenda widget. Hand-rolled (no
// dependency) and deliberately small: it pulls upcoming VEVENTs (summary, start,
// end, location) from a published .ics feed. Recurring events (RRULE) are NOT
// expanded — only each event's base DTSTART is read, so a repeating event shows
// at most its first occurrence. Many feeds (e.g. Google's secret address) keep
// recurrence as RRULE rather than expanding it, so repeats may be missing; this
// is a known v1 limitation.

export type CalendarEvent = {
  summary: string;
  start: number; // epoch ms
  end?: number; // epoch ms
  allDay: boolean;
  location?: string;
};

const DAY_MS = 86_400_000;

// Unfold folded lines: a line beginning with a space or tab continues the
// previous one (RFC 5545 §3.1).
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

// Split "NAME;PARAM=v;PARAM2=v:value" into its name, params, and raw value.
function parseLine(
  line: string
): { name: string; params: Record<string, string>; value: string } | null {
  const idx = line.indexOf(":");
  if (idx < 0) return null;
  const segs = line.slice(0, idx).split(";");
  const params: Record<string, string> = {};
  for (let i = 1; i < segs.length; i++) {
    const eq = segs[i].indexOf("=");
    if (eq > 0) {
      params[segs[i].slice(0, eq).toUpperCase()] = segs[i]
        .slice(eq + 1)
        .replace(/^"|"$/g, "");
    }
  }
  return { name: segs[0].toUpperCase(), params, value: line.slice(idx + 1) };
}

// Unescape the TEXT value type: \n \, \; \\ (RFC 5545 §3.3.11). Newlines are
// collapsed to spaces so a multi-line summary stays on one row.
function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

// The UTC offset (ms) of a zone at a given instant, via Intl — used to turn a
// TZID wall-clock time into an absolute instant without a tz database.
function zoneOffset(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const o: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") o[p.type] = Number(p.value);
  const asUTC = Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second);
  return asUTC - utcMs;
}

// Convert a wall-clock time in `tz` to a UTC instant (two passes settle DST).
function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string
): number {
  const guess = Date.UTC(y, mo, d, h, mi, s);
  const off = zoneOffset(guess - zoneOffset(guess, tz), tz);
  return guess - off;
}

// Parse a DATE or DATE-TIME value into an instant + all-day flag. Handles
// `YYYYMMDD` (all-day), `…T…Z` (UTC), and `…T…` with a TZID (else floating,
// treated as UTC best-effort).
export function parseICalDate(
  value: string,
  params: Record<string, string>
): { ms: number; allDay: boolean } | null {
  const v = value.trim();
  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    return m ? { ms: Date.UTC(+m[1], +m[2] - 1, +m[3]), allDay: true } : null;
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const [, Y, Mo, D, H, Mi, S, Z] = m;
  const y = +Y,
    mo = +Mo - 1,
    d = +D,
    h = +H,
    mi = +Mi,
    s = +S;
  if (Z === "Z") return { ms: Date.UTC(y, mo, d, h, mi, s), allDay: false };
  const tz = params.TZID;
  if (tz && isValidTimeZone(tz)) {
    return { ms: zonedToUtc(y, mo, d, h, mi, s, tz), allDay: false };
  }
  return { ms: Date.UTC(y, mo, d, h, mi, s), allDay: false };
}

// Parse every VEVENT in an .ics document into events (unsorted, unfiltered).
export function parseICS(text: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  let cur: Partial<CalendarEvent> | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur && cur.summary && typeof cur.start === "number") {
        events.push({
          summary: cur.summary,
          start: cur.start,
          end: cur.end,
          allDay: cur.allDay ?? false,
          location: cur.location,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "SUMMARY") cur.summary = unescapeText(p.value);
    else if (p.name === "LOCATION") cur.location = unescapeText(p.value) || undefined;
    else if (p.name === "DTSTART") {
      const d = parseICalDate(p.value, p.params);
      if (d) {
        cur.start = d.ms;
        cur.allDay = d.allDay;
      }
    } else if (p.name === "DTEND") {
      const d = parseICalDate(p.value, p.params);
      if (d) cur.end = d.ms;
    }
  }
  return events;
}

// Sort by start and keep the next `count` events that haven't finished yet (an
// all-day event without an explicit end runs to the end of its day).
export function upcomingEvents(
  events: CalendarEvent[],
  now: number,
  count: number
): CalendarEvent[] {
  return events
    .filter((e) => (e.end ?? (e.allDay ? e.start + DAY_MS : e.start)) > now)
    .sort((a, b) => a.start - b.start)
    .slice(0, Math.max(0, count));
}

const CAL_TIMEOUT_MS = 6000;

// Fetch + parse a published calendar, returning the next `count` upcoming
// events. Best-effort: any network/parse failure yields an empty list rather
// than throwing. `webcal://` URLs are normalized to https.
export async function fetchCalendar(
  url: string,
  count = 5
): Promise<CalendarEvent[]> {
  const target = url.trim().replace(/^webcal:\/\//i, "https://");
  if (!/^https?:\/\//i.test(target)) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAL_TIMEOUT_MS);
  try {
    const res = await fetch(target, { signal: controller.signal });
    if (!res.ok) return [];
    const text = await res.text();
    return upcomingEvents(parseICS(text), Date.now(), count);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
