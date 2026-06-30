import { isValidTimeZone } from "./datetime";

// Minimal iCalendar (RFC 5545) reader for the agenda widget. Hand-rolled (no
// dependency) and deliberately small: it pulls upcoming VEVENTs (summary, start,
// end, location) from a published .ics feed, and expands a practical subset of
// recurring events (RRULE: FREQ/INTERVAL/COUNT/UNTIL + weekly BYDAY, honoring
// EXDATE cancellations and RECURRENCE-ID overrides) over a bounded window so
// weekly/monthly meetings actually surface. Not yet handled: monthly/yearly
// BYDAY ordinals (e.g. "2nd Tuesday"), BYMONTHDAY/BYSETPOS, and other rarer
// RFC 5545 recurrence parts.

export type CalendarEvent = {
  summary: string;
  start: number; // epoch ms
  end?: number; // epoch ms
  allDay: boolean;
  location?: string;
  // Recurrence metadata, present only on the series master (rrule) or on a
  // RECURRENCE-ID override instance. Stripped out once events are expanded.
  rrule?: RecurrenceRule;
  exdates?: number[]; // cancelled occurrence starts (epoch ms)
  tzid?: string; // zone the wall-clock time is anchored in, for re-anchoring
  uid?: string;
  recurrenceId?: number; // original start this event overrides, for its `uid`
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

// ---- Recurrence (RRULE) expansion -----------------------------------------

export type RecurrenceRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: number; // epoch ms, inclusive
  byDay?: number[]; // 0=Sun..6=Sat, applied for WEEKLY
};

const WEEKDAY: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

// Parse an RRULE value into the supported subset. Returns null for an
// unsupported or malformed FREQ (the event then behaves as a one-off).
export function parseRRule(value: string): RecurrenceRule | null {
  const parts: Record<string, string> = {};
  for (const seg of value.split(";")) {
    const eq = seg.indexOf("=");
    if (eq > 0) parts[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1);
  }
  const freq = parts.FREQ?.toUpperCase();
  if (
    freq !== "DAILY" &&
    freq !== "WEEKLY" &&
    freq !== "MONTHLY" &&
    freq !== "YEARLY"
  )
    return null;
  const interval = Math.max(1, parseInt(parts.INTERVAL ?? "1", 10) || 1);
  const rule: RecurrenceRule = { freq, interval };
  const count = parseInt(parts.COUNT ?? "", 10);
  if (count > 0) rule.count = count;
  if (parts.UNTIL) {
    const u = parseICalDate(parts.UNTIL.trim(), {});
    // A date-only UNTIL is inclusive of that whole day.
    if (u) rule.until = u.allDay ? u.ms + DAY_MS - 1 : u.ms;
  }
  if (parts.BYDAY) {
    const days = parts.BYDAY.split(",")
      .map((d) => WEEKDAY[d.trim().slice(-2).toUpperCase()])
      .filter((d): d is number => d !== undefined);
    if (days.length) rule.byDay = days;
  }
  return rule;
}

// Wall-clock parts of an instant in a zone, so each occurrence can be re-anchored
// to the same local time (a 9am weekly meeting stays 9am across a DST change).
function wallParts(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const o: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, mo: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second };
}

type YMD = { y: number; mo: number; d: number };

// Calendar arithmetic in UTC component space: the zone only matters when the
// final wall components are turned back into an instant (via zonedToUtc), so day
// and month stepping can be done with plain UTC dates.
const dayNum = (y: number, mo: number, d: number) =>
  Math.floor(Date.UTC(y, mo - 1, d) / DAY_MS);
function fromDayNum(n: number): YMD {
  const dt = new Date(n * DAY_MS);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
const mondayIndex = (n: number) => (new Date(n * DAY_MS).getUTCDay() + 6) % 7;
// Add `n` months, keeping the day-of-month; returns null when the target month
// has no such day (e.g. Feb 30), which RFC 5545 skips rather than clamps.
function addMonths(y: number, mo: number, d: number, n: number): YMD | null {
  const total = y * 12 + (mo - 1) + n;
  const ny = Math.floor(total / 12);
  const nmo = (total % 12) + 1;
  const dim = new Date(Date.UTC(ny, nmo, 0)).getUTCDate();
  return d > dim ? null : { y: ny, mo: nmo, d };
}

// A chronological stream of occurrence dates from the series start. When
// `ffDay` is set (safe only without COUNT) it jumps ahead to near that day so we
// don't iterate years of history before the window. The consumer bounds it.
function* occurrenceDates(
  rule: RecurrenceRule,
  start: YMD,
  ffDay: number | null
): Generator<YMD> {
  const startNum = dayNum(start.y, start.mo, start.d);
  if (rule.freq === "DAILY") {
    let n = startNum;
    if (ffDay != null && ffDay > startNum) {
      n = startNum + Math.ceil((ffDay - startNum) / rule.interval) * rule.interval;
    }
    for (;;) {
      yield fromDayNum(n);
      n += rule.interval;
    }
  } else if (rule.freq === "WEEKLY") {
    const startDow = new Date(startNum * DAY_MS).getUTCDay();
    const byDay = rule.byDay ?? [startDow];
    const startWeek = startNum - mondayIndex(startNum);
    let n = ffDay != null && ffDay > startNum ? ffDay : startNum;
    for (;;) {
      const week = (n - mondayIndex(n) - startWeek) / 7;
      if (
        n >= startNum &&
        week % rule.interval === 0 &&
        byDay.includes(new Date(n * DAY_MS).getUTCDay())
      )
        yield fromDayNum(n);
      n++;
    }
  } else {
    const stepMonths = rule.freq === "YEARLY" ? rule.interval * 12 : rule.interval;
    let k = 0;
    if (ffDay != null) {
      const ff = fromDayNum(ffDay);
      const diff = ff.y * 12 + (ff.mo - 1) - (start.y * 12 + (start.mo - 1));
      if (diff > 0) k = Math.floor(diff / stepMonths);
    }
    for (let guard = 0; guard < 20000; guard++, k++) {
      const d = addMonths(start.y, start.mo, start.d, k * stepMonths);
      if (d) yield d;
    }
  }
}

const RECUR_WINDOW_MS = 62 * DAY_MS;
const RECUR_CAP = 1500; // max occurrences examined per series, a safety bound

// Expand one recurring master into concrete occurrences that fall within
// (now, windowEnd], skipping cancelled (EXDATE) and overridden (RECURRENCE-ID)
// instances. Past, finished occurrences are dropped here too.
function expandOne(
  e: CalendarEvent,
  now: number,
  windowEnd: number,
  overrides: Set<string>
): CalendarEvent[] {
  const rule = e.rrule!;
  const tz = e.allDay ? "UTC" : e.tzid && isValidTimeZone(e.tzid) ? e.tzid : "UTC";
  const base = wallParts(e.start, tz);
  const hasEnd = e.end != null;
  const duration = hasEnd ? e.end! - e.start : 0;
  const exset = new Set(e.exdates ?? []);
  // COUNT must be tallied from the series start, so it disables fast-forward.
  const ffDay = rule.count != null ? null : Math.floor((now - DAY_MS) / DAY_MS);
  const out: CalendarEvent[] = [];
  let generated = 0;
  let iter = 0;
  for (const date of occurrenceDates(rule, { y: base.y, mo: base.mo, d: base.d }, ffDay)) {
    if (++iter > RECUR_CAP) break;
    if (rule.count != null && generated >= rule.count) break;
    const instant = e.allDay
      ? Date.UTC(date.y, date.mo - 1, date.d)
      : zonedToUtc(date.y, date.mo - 1, date.d, base.h, base.mi, base.s, tz);
    if (rule.until != null && instant > rule.until) break;
    generated++;
    if (instant > windowEnd) break;
    const effEnd = hasEnd ? instant + duration : e.allDay ? instant + DAY_MS : instant;
    if (effEnd <= now) continue; // already finished
    if (exset.has(instant)) continue; // cancelled occurrence
    if (e.uid && overrides.has(`${e.uid}|${instant}`)) continue; // replaced
    out.push({
      summary: e.summary,
      start: instant,
      end: hasEnd ? instant + duration : undefined,
      allDay: e.allDay,
      location: e.location,
    });
  }
  return out;
}

// Turn a parsed event list into plain, expanded occurrences within the window.
// Non-recurring events pass through (with recurrence metadata stripped); masters
// are expanded; RECURRENCE-ID overrides ride through as their own one-offs and
// suppress the matching generated instance.
export function expandRecurring(
  events: CalendarEvent[],
  now: number,
  windowEnd: number
): CalendarEvent[] {
  const overrides = new Set<string>();
  for (const e of events)
    if (e.recurrenceId != null && e.uid) overrides.add(`${e.uid}|${e.recurrenceId}`);
  const out: CalendarEvent[] = [];
  for (const e of events) {
    if (e.rrule) {
      out.push(...expandOne(e, now, windowEnd, overrides));
    } else {
      out.push({
        summary: e.summary,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        location: e.location,
      });
    }
  }
  return out;
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
        const ev: CalendarEvent = {
          summary: cur.summary,
          start: cur.start,
          end: cur.end,
          allDay: cur.allDay ?? false,
          location: cur.location,
        };
        if (cur.rrule) {
          ev.rrule = cur.rrule;
          if (cur.tzid) ev.tzid = cur.tzid;
          if (cur.uid) ev.uid = cur.uid;
          if (cur.exdates?.length) ev.exdates = cur.exdates;
        }
        if (cur.recurrenceId != null) {
          ev.recurrenceId = cur.recurrenceId;
          if (cur.uid) ev.uid = cur.uid;
        }
        events.push(ev);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "SUMMARY") cur.summary = unescapeText(p.value);
    else if (p.name === "LOCATION") cur.location = unescapeText(p.value) || undefined;
    else if (p.name === "UID") cur.uid = p.value.trim();
    else if (p.name === "RRULE") {
      const r = parseRRule(p.value);
      if (r) cur.rrule = r;
    } else if (p.name === "RECURRENCE-ID") {
      cur.recurrenceId = parseICalDate(p.value, p.params)?.ms;
    } else if (p.name === "EXDATE") {
      for (const raw of p.value.split(",")) {
        const d = parseICalDate(raw, p.params);
        if (d) (cur.exdates ??= []).push(d.ms);
      }
    } else if (p.name === "DTSTART") {
      const d = parseICalDate(p.value, p.params);
      if (d) {
        cur.start = d.ms;
        cur.allDay = d.allDay;
        if (p.params.TZID) cur.tzid = p.params.TZID;
      }
    } else if (p.name === "DTEND") {
      const d = parseICalDate(p.value, p.params);
      if (d) cur.end = d.ms;
    }
  }
  return events;
}

// `YYYY-MM-DD` for an instant rendered in a zone, for day-equality checks.
function ymd(ms: number, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

// The day label ("Today" / "Tomorrow" / "Wed, Jul 1") and time for an event.
// All-day events are formatted in UTC — the zone they're anchored in — so their
// date never slips in a viewer zone behind UTC; timed events use `tz`. `now`
// anchors the relative labels (in `tz`).
export function eventWhen(
  event: CalendarEvent,
  tz: string,
  now: number
): { day: string; time: string } {
  // tz now flows from per-visitor prefs (localStorage / Intl detection), so guard
  // it: an unknown zone would make Intl throw rather than just look wrong.
  if (!isValidTimeZone(tz)) tz = "UTC";
  const zone = event.allDay ? "UTC" : tz;
  const key = ymd(event.start, zone);
  const day =
    key === ymd(now, tz)
      ? "Today"
      : key === ymd(now + DAY_MS, tz)
        ? "Tomorrow"
        : new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            weekday: "short",
            month: "short",
            day: "numeric",
          }).format(new Date(event.start));
  const time = event.allDay
    ? "All day"
    : new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(event.start));
  return { day, time };
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
const CAL_CACHE_TTL_MS = 5 * 60_000;

// Parsed-event cache keyed by URL, so the homepage (force-dynamic) doesn't make
// a blocking third-party request on every render. Held on globalThis to survive
// module-graph duplication, like the status-history store.
type CalCacheEntry = { events: CalendarEvent[]; at: number };
const g = globalThis as unknown as {
  __ctrlcenterCalCache?: Map<string, CalCacheEntry>;
};
const calCache = (g.__ctrlcenterCalCache ??= new Map());

async function fetchAndParse(target: string): Promise<CalendarEvent[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAL_TIMEOUT_MS);
  try {
    const res = await fetch(target, { signal: controller.signal });
    if (!res.ok) return null;
    return parseICS(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Fetch + parse a published calendar (cached for a few minutes), returning the
// next `count` upcoming events. Best-effort: a fetch/parse failure serves the
// last good cache if there is one, else an empty list — it never throws.
// `webcal://` URLs are normalized to https.
export async function fetchCalendar(
  url: string,
  count = 5
): Promise<CalendarEvent[]> {
  const target = url.trim().replace(/^webcal:\/\//i, "https://");
  if (!/^https?:\/\//i.test(target)) return [];
  const now = Date.now();
  const cached = calCache.get(target);
  let events = cached?.events;
  if (!cached || now - cached.at >= CAL_CACHE_TTL_MS) {
    const fresh = await fetchAndParse(target);
    if (fresh) {
      events = fresh;
      calCache.set(target, { events: fresh, at: now });
    }
    // On failure, keep serving the stale cache (events stays as cached?.events).
  }
  const expanded = expandRecurring(events ?? [], now, now + RECUR_WINDOW_MS);
  return upcomingEvents(expanded, now, count);
}
