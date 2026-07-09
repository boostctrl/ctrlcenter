// State derivation + window formatting for the /status page's announcement
// notices (see lib/schema.ts `statusAnnouncementSchema`). Kept separate from the
// React components so the timing logic is unit-testable in isolation.

import type { StatusAnnouncement } from "./schema";

// Whether an entry is showing now, still upcoming, or already over. Expired
// entries never render; active and scheduled do (active first).
export type AnnouncementState = "active" | "scheduled" | "expired";

// A visible entry paired with its derived state (expired ones are filtered out).
export type OrderedAnnouncement = {
  announcement: StatusAnnouncement;
  state: Exclude<AnnouncementState, "expired">;
};

// Parse a stored UTC ISO instant to epoch ms. Empty or unparsable → null, which
// the caller treats as "unset" (an unparsable date must never make an entry
// vanish — it's simply ignored, so a typo'd window degrades to "always active").
function parseInstant(value: string): number | null {
  if (!value || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

// Derive an entry's state from its window and the current instant. A window is
// optional: both bounds unset → "active" (shown until removed). Once `endsAt`
// has passed the entry is "expired"; before `startsAt` it's "scheduled";
// otherwise "active". Checking end before start keeps a finished window expired
// even if its start was (mis)configured after its end.
export function announcementState(
  a: Pick<StatusAnnouncement, "startsAt" | "endsAt">,
  now: number
): AnnouncementState {
  const start = parseInstant(a.startsAt);
  const end = parseInstant(a.endsAt);
  if (end !== null && now >= end) return "expired";
  if (start !== null && now < start) return "scheduled";
  return "active";
}

// Filter out expired entries and order the rest for display: active first, then
// scheduled. Within active, soonest-ending first with windowless (no end) last;
// within scheduled, soonest-starting first. Array.sort is stable, so entries
// that tie keep their configured order.
export function visibleAnnouncements(
  list: StatusAnnouncement[],
  now: number
): OrderedAnnouncement[] {
  const rank = { active: 0, scheduled: 1 };
  return list
    .map((announcement) => ({
      announcement,
      state: announcementState(announcement, now),
    }))
    .filter(
      (e): e is OrderedAnnouncement => e.state !== "expired"
    )
    .sort((a, b) => {
      if (a.state !== b.state) return rank[a.state] - rank[b.state];
      if (a.state === "active") {
        const ae = parseInstant(a.announcement.endsAt);
        const be = parseInstant(b.announcement.endsAt);
        if (ae === null && be === null) return 0;
        if (ae === null) return 1; // windowless active sinks below timed ones
        if (be === null) return -1;
        return ae - be;
      }
      // scheduled: soonest-starting first
      return (
        (parseInstant(a.announcement.startsAt) ?? 0) -
        (parseInstant(b.announcement.startsAt) ?? 0)
      );
    });
}

// One instant, or a start–end range, in the visitor's time zone. Copies the
// thin-space normalization from formatBarLabel (lib/status.ts) so formatRange's
// special spaces (thin space around the en dash, narrow no-break space before
// AM/PM) read as plain spaces like the rest of the app; falls back to UTC when
// the zone is invalid.
const WINDOW_OPTS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

function normalizeSpaces(s: string): string {
  return s.replace(/[\u2009\u202f\u00a0]/g, " ");
}

function formatInstant(ms: number, timeZone: string): string {
  const fmt = (tz: string) =>
    normalizeSpaces(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, ...WINDOW_OPTS }).format(
        new Date(ms)
      )
    );
  try {
    return fmt(timeZone);
  } catch {
    return fmt("UTC");
  }
}

function formatRange(startMs: number, endMs: number, timeZone: string): string {
  const fmt = (tz: string) =>
    normalizeSpaces(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        ...WINDOW_OPTS,
      }).formatRange(new Date(startMs), new Date(endMs))
    );
  try {
    return fmt(timeZone);
  } catch {
    return fmt("UTC");
  }
}

// The window line an entry shows under its body, in the visitor's zone:
//   scheduled + start & end → "Sat, Jul 11, 8:00 – 10:00 AM"
//   scheduled + start only  → "Starts Sat, Jul 11, 8:00 AM"
//   active + end            → "Until Sat, Jul 11, 10:00 AM"
// Anything else (active windowless, or a scheduled entry with no parsable
// start) → "" and the caller renders no window line.
export function announcementWindowLabel(
  a: Pick<StatusAnnouncement, "startsAt" | "endsAt">,
  state: Exclude<AnnouncementState, "expired">,
  timeZone: string
): string {
  const start = parseInstant(a.startsAt);
  const end = parseInstant(a.endsAt);
  if (state === "scheduled") {
    if (start !== null && end !== null) return formatRange(start, end, timeZone);
    if (start !== null) return `Starts ${formatInstant(start, timeZone)}`;
    return "";
  }
  // active
  if (end !== null) return `Until ${formatInstant(end, timeZone)}`;
  return "";
}
