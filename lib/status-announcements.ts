// State derivation + window formatting for the /status page's announcement
// notices (see lib/schema.ts `statusAnnouncementSchema`). Kept separate from the
// React components so the timing logic is unit-testable in isolation.

import { formatInZone, formatRangeInZone, normalizeIntlSpaces } from "./datetime";
import type {
  AnnouncementTone,
  StatusAnnouncement,
  StatusAnnouncementKind,
} from "./schema";

// How each kind presents, in one place so the /status card and the admin
// editor can never disagree on a kind's name or tint. Tones borrow the site
// banner's palette (lib/announcement-tones.ts) so the cards read in the same
// visual language: maintenance is informational (blue), an incident is a
// warning (amber), a general note takes the accent. The info kind is labelled
// "Notice" to avoid colliding with the banner's separate "Info" tone name.
export const STATUS_ANNOUNCEMENT_KIND_META: Record<
  StatusAnnouncementKind,
  { label: string; tone: AnnouncementTone }
> = {
  maintenance: { label: "Maintenance", tone: "info" },
  incident: { label: "Incident", tone: "warning" },
  info: { label: "Notice", tone: "accent" },
};

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

// An entry's usable window. An end at or before its start is a misconfigured
// window: keep the start and ignore the end — degrading toward "shown", like
// unparsable dates above — rather than rendering a backwards range or expiring
// an entry that never got to run.
function parseWindow(a: Pick<StatusAnnouncement, "startsAt" | "endsAt">): {
  start: number | null;
  end: number | null;
} {
  const start = parseInstant(a.startsAt);
  let end = parseInstant(a.endsAt);
  if (start !== null && end !== null && end <= start) end = null;
  return { start, end };
}

// Derive an entry's state from its window and the current instant. A window is
// optional: both bounds unset → "active" (shown until removed). Once `endsAt`
// has passed the entry is "expired"; before `startsAt` it's "scheduled";
// otherwise "active".
export function announcementState(
  a: Pick<StatusAnnouncement, "startsAt" | "endsAt">,
  now: number
): AnnouncementState {
  const { start, end } = parseWindow(a);
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
        const ae = parseWindow(a.announcement).end;
        const be = parseWindow(b.announcement).end;
        if (ae === null && be === null) return 0;
        if (ae === null) return 1; // windowless active sinks below timed ones
        if (be === null) return -1;
        return ae - be;
      }
      // scheduled: soonest-starting first
      return (
        (parseWindow(a.announcement).start ?? 0) -
        (parseWindow(b.announcement).start ?? 0)
      );
    });
}

// The Intl shape every window label uses, formatted in the visitor's zone via
// the shared zone-degrading helpers in lib/datetime.ts.
const WINDOW_OPTS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

// Space-normalized like the range form, so "Starts …"/"Until …" lines read
// with the same plain spaces as "Sat, Jul 11, 8:00 – 10:00 AM".
function formatInstant(ms: number, timeZone: string): string {
  return normalizeIntlSpaces(formatInZone(new Date(ms), timeZone, WINDOW_OPTS));
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
  const { start, end } = parseWindow(a);
  if (state === "scheduled") {
    if (start !== null && end !== null) {
      return formatRangeInZone(
        new Date(start),
        new Date(end),
        timeZone,
        WINDOW_OPTS
      );
    }
    if (start !== null) return `Starts ${formatInstant(start, timeZone)}`;
    return "";
  }
  // active
  if (end !== null) return `Until ${formatInstant(end, timeZone)}`;
  return "";
}
