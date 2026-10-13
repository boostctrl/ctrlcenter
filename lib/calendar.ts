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

export const DAY_MS = 86_400_000;

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

// The formatters the per-occurrence helpers below read through. Building an
// Intl.DateTimeFormat costs far more than using one, and these used to be
// built afresh for every occurrence — twice per zoned instant — so a feed of
// long series cost seconds of CPU per page view (#381). One per zone and kind,
// reused; zone names come from the feed (Intl accepts any casing of one), so
// the cache is emptied rather than left to grow past a handful.
const FORMATS = {
  wall: [
    "en-US",
    {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    },
  ],
  ymd: ["en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }],
} as const satisfies Record<string, readonly [string, Intl.DateTimeFormatOptions]>;
const MAX_FORMATTERS = 64;
const formatters = new Map<string, Intl.DateTimeFormat>();
function zoneFormat(kind: keyof typeof FORMATS, timeZone: string): Intl.DateTimeFormat {
  const key = `${kind} ${timeZone}`;
  let f = formatters.get(key);
  if (!f) {
    if (formatters.size >= MAX_FORMATTERS) formatters.clear();
    const [locale, options] = FORMATS[kind];
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    formatters.set(key, f);
  }
  return f;
}

// Whether Intl knows a zone. lib/datetime's isValidTimeZone answers by
// building a throwaway formatter, once per event or series here; the cached
// one makes a repeat zone free.
function validZone(tz: string): boolean {
  try {
    zoneFormat("wall", tz);
    return true;
  } catch {
    return false;
  }
}

// The wall-clock fields (year, month, day, hour, minute, second) of an instant
// in a zone, as numbers.
function wallFields(ms: number, tz: string): Record<string, number> {
  const o: Record<string, number> = {};
  for (const p of zoneFormat("wall", tz).formatToParts(new Date(ms)))
    if (p.type !== "literal") o[p.type] = Number(p.value);
  return o;
}

// The UTC offset (ms) of a zone at a given instant, via Intl — used to turn a
// TZID wall-clock time into an absolute instant without a tz database.
function zoneOffset(utcMs: number, tz: string): number {
  const o = wallFields(utcMs, tz);
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
  if (tz === "UTC") return guess; // nothing to settle; spare the Intl calls (#381)
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
  if (tz && validZone(tz)) {
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

// RFC 5545 sets no ceiling on INTERVAL, but a feed is third-party input —
// anyone who can add an event to a subscribed calendar writes it — and a huge
// one used to hang the server or break the page (#381). 1000 is far past any
// real series (every 1000 days is ~2.7 years, every 1000 weeks ~19), so the
// clamp changes nothing a person would schedule; the occurrence streams below
// are bounded on their own as well, so it isn't the only line of defence.
export const MAX_INTERVAL = 1000;

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
  const interval = Math.min(
    MAX_INTERVAL,
    Math.max(1, parseInt(parts.INTERVAL ?? "1", 10) || 1)
  );
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
  const o = wallFields(ms, tz);
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

// iCalendar years have four digits, so nothing after 9999 is a real
// occurrence. Every stream below ends there: past Date's range a step used to
// produce an Invalid Date, which threw out of the zone conversion and broke
// every page showing the calendar (#381).
const LAST_YEAR = 9999;
const LAST_DAY = dayNum(LAST_YEAR, 12, 31);

// A chronological stream of occurrence dates from the series start. When
// `ffDay` is set (safe only without COUNT) it jumps ahead to near that day so we
// don't iterate years of history before the window. The consumer bounds how
// many it takes; each stream also ends on its own at LAST_DAY, and does work
// only in proportion to what it yields, so that bound is a bound on time too.
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
    for (; n <= LAST_DAY; n += rule.interval) yield fromDayNum(n);
  } else if (rule.freq === "WEEKLY") {
    // Step whole interval weeks (Monday-start) and emit their BYDAY days in
    // order. This used to walk every day and test it, yielding only inside an
    // interval week, so a huge INTERVAL spun between yields forever and the
    // consumer's cap — which counts yields — never got a turn (#381). Now
    // every step after the first yields.
    const startDow = new Date(startNum * DAY_MS).getUTCDay();
    const offsets = [...new Set(rule.byDay?.length ? rule.byDay : [startDow])]
      .map((dow) => (dow + 6) % 7)
      .sort((a, b) => a - b);
    const from = ffDay != null && ffDay > startNum ? ffDay : startNum;
    const step = 7 * rule.interval;
    const startWeek = startNum - mondayIndex(startNum);
    // The last interval week starting on or before `from`.
    let week = startWeek + Math.floor((from - startWeek) / step) * step;
    for (; week <= LAST_DAY; week += step) {
      for (const offset of offsets) {
        const n = week + offset;
        if (n >= from && n <= LAST_DAY) yield fromDayNum(n);
      }
    }
  } else {
    const stepMonths = rule.freq === "YEARLY" ? rule.interval * 12 : rule.interval;
    const startMonth = start.y * 12 + (start.mo - 1);
    let k = 0;
    if (ffDay != null) {
      const ff = fromDayNum(ffDay);
      const diff = ff.y * 12 + (ff.mo - 1) - startMonth;
      if (diff > 0) k = Math.floor(diff / stepMonths);
    }
    for (let guard = 0; guard < 20000; guard++, k++) {
      if (startMonth + k * stepMonths > LAST_YEAR * 12 + 11) return;
      const d = addMonths(start.y, start.mo, start.d, k * stepMonths);
      if (d) yield d;
    }
  }
}

export const RECUR_WINDOW_MS = 62 * DAY_MS;
const RECUR_CAP = 1500; // max occurrences examined per series, a safety bound
// RECUR_CAP bounds one series, but a 5 MB feed holds tens of thousands of
// them, so a feed's whole expansion draws on one budget (#381). A date passed
// over costs 1; setting up a series or converting a date in its zone is Intl
// work, some fifty times dearer, and costs ZONED_COST. Spent either way, the
// budget comes to a few hundred ms at most, and a busy real calendar uses a
// fraction of it: a hundred zoned weekly meetings over the /calendar page's
// range draw about 150,000.
const EXPAND_BUDGET = 1_000_000;
const ZONED_COST = 50;

// Expand one recurring master into concrete occurrences that fall within
// (now, windowEnd], skipping cancelled (EXDATE) and overridden (RECURRENCE-ID)
// instances. Past, finished occurrences are dropped here too. The work is
// drawn from `budget`, shared by every series in the feed.
function expandOne(
  e: CalendarEvent,
  now: number,
  windowEnd: number,
  overrides: Set<string>,
  budget: { left: number }
): CalendarEvent[] {
  budget.left -= ZONED_COST;
  if (budget.left < 0) return [];
  const rule = e.rrule!;
  const tz = e.allDay ? "UTC" : e.tzid && validZone(e.tzid) ? e.tzid : "UTC";
  const zoned = tz !== "UTC";
  const base = wallParts(e.start, tz);
  const hasEnd = e.end != null;
  const duration = hasEnd ? e.end! - e.start : 0;
  // How long past its start an occurrence runs (an all-day one without an end
  // runs to the end of its day).
  const span = hasEnd ? duration : e.allDay ? DAY_MS : 0;
  const exset = new Set(e.exdates ?? []);
  // COUNT must be tallied from the series start, so it disables fast-forward.
  const ffDay = rule.count != null ? null : Math.floor((now - DAY_MS) / DAY_MS);
  const out: CalendarEvent[] = [];
  let generated = 0;
  let iter = 0;
  for (const date of occurrenceDates(rule, { y: base.y, mo: base.mo, d: base.d }, ffDay)) {
    if (++iter > RECUR_CAP || --budget.left < 0) break;
    if (rule.count != null && generated >= rule.count) break;
    // The wall-clock time read as UTC is the instant itself outside a zone and
    // within a day of it in any zone. A date that surely ended before `now`,
    // inside UNTIL and the window, is only counted: a COUNT series walks from
    // its start, and converting each of those past dates was most of the cost
    // of a long series (#381).
    const wall = Date.UTC(date.y, date.mo - 1, date.d, base.h, base.mi, base.s);
    const latest = zoned ? wall + DAY_MS : wall;
    if (
      latest + Math.max(span, 0) <= now &&
      latest <= windowEnd &&
      (rule.until == null || latest <= rule.until)
    ) {
      generated++;
      continue;
    }
    if (zoned) budget.left -= ZONED_COST;
    const instant = e.allDay
      ? Date.UTC(date.y, date.mo - 1, date.d)
      : zonedToUtc(date.y, date.mo - 1, date.d, base.h, base.mi, base.s, tz);
    if (rule.until != null && instant > rule.until) break;
    generated++;
    if (instant > windowEnd) break;
    const effEnd = instant + span;
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
  const budget = { left: EXPAND_BUDGET };
  for (const e of events) {
    if (e.rrule) {
      // A series that still fails to expand is dropped on its own: one bad
      // event in a feed used to throw out of every page showing it (#381).
      try {
        out.push(...expandOne(e, now, windowEnd, overrides, budget));
      } catch {
        continue;
      }
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
  return zoneFormat("ymd", zone).format(new Date(ms));
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
  if (!validZone(tz)) tz = "UTC";
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

// --- Month grid (for the /calendar month view and the home mini-month) ---

// A single day cell: its ISO date, day-of-month number, whether it belongs to the
// displayed month (vs a leading/trailing neighbour), and whether it's the
// viewer's today.
export type MonthCell = {
  iso: string; // YYYY-MM-DD
  day: number;
  inMonth: boolean;
  isToday: boolean;
};

export type MonthGrid = {
  year: number;
  month: number; // 1-12
  label: string; // e.g. "July 2026"
  weeks: MonthCell[][]; // rows of 7, Sunday-first
};

// The ISO day an event sits on for the viewer's zone. All-day events are anchored
// in UTC (like eventWhen), so their date never slips in a zone behind UTC.
export function eventDayKey(event: CalendarEvent, tz: string): string {
  return ymd(event.start, event.allDay ? "UTC" : validZone(tz) ? tz : "UTC");
}

// Group events by their ISO day for the viewer's zone; each day's list is sorted
// by start. Multi-day events are placed on their start day only.
export function bucketByDay(
  events: CalendarEvent[],
  tz: string
): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const key = eventDayKey(e, tz);
    const arr = map.get(key);
    if (arr) arr.push(e);
    else map.set(key, [e]);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.start - b.start);
  return map;
}

// Build a Sunday-first month grid for the month containing `reference` (shifted
// by `monthOffset` whole months), labelled in `tz`. A date's weekday and a
// month's length don't depend on the zone, so the grid is computed from plain
// calendar math (via UTC) and stays hydration-stable; only the today flag uses
// the zone. Trailing/leading days fill each week from the neighbouring months.
export function buildMonthGrid(
  reference: number,
  tz: string,
  monthOffset = 0
): MonthGrid {
  const zone = validZone(tz) ? tz : "UTC";
  const todayIso = ymd(reference, zone);
  const [ty, tm] = todayIso.split("-").map(Number); // viewer's today year, month (1-12)
  const base = tm - 1 + monthOffset; // zero-based month index relative to year ty
  const year = ty + Math.floor(base / 12);
  const month0 = ((base % 12) + 12) % 12;
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month0, 1)).getUTCDay(); // 0 = Sun
  const label = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month0, 1)));

  const iso = (y: number, m0: number, d: number) =>
    `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const makeCell = (y: number, m0: number, d: number, inMonth: boolean): MonthCell => {
    const s = iso(y, m0, d);
    return { iso: s, day: d, inMonth, isToday: s === todayIso };
  };

  const cells: MonthCell[] = [];
  // Leading days from the previous month to reach the first weekday.
  if (firstWeekday > 0) {
    const prevDays = new Date(Date.UTC(year, month0, 0)).getUTCDate();
    const py = month0 === 0 ? year - 1 : year;
    const pm0 = (month0 + 11) % 12;
    for (let i = firstWeekday; i > 0; i--) cells.push(makeCell(py, pm0, prevDays - i + 1, false));
  }
  // The month itself.
  for (let d = 1; d <= daysInMonth; d++) cells.push(makeCell(year, month0, d, true));
  // Trailing days from the next month to complete the final week.
  const ny = month0 === 11 ? year + 1 : year;
  const nm0 = (month0 + 1) % 12;
  let nd = 1;
  while (cells.length % 7 !== 0) cells.push(makeCell(ny, nm0, nd++, false));

  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { year, month: month0 + 1, label, weeks };
}
