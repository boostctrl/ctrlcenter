// Date/time helpers shared by server (initial seed strings) and client
// components. Kept free of "use client" so both can import them.

export function greetingFor(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// `Intl.DateTimeFormat` throws `RangeError` on an unknown time zone, and the zone
// reaches us from config (admin can hand-edit / type a free-text value) and from
// per-visitor localStorage — neither is guaranteed valid. Validate once and fall
// back to UTC so a bad value degrades to UTC time instead of crashing SSR (the
// Header is a server component) or the client clock.
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function safeZone(timeZone: string): string {
  return isValidTimeZone(timeZone) ? timeZone : "UTC";
}

export function hourIn(date: Date, timeZone: string): number {
  return parseInt(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: safeZone(timeZone),
    }).format(date),
    10
  );
}

export function shortDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: safeZone(timeZone),
  })
    .format(date)
    .toUpperCase();
}

export function timeString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: safeZone(timeZone),
  }).format(date);
}

// formatRange separates its parts with special spaces — a thin space around
// the en dash, a narrow no-break space before AM/PM — while the app's plain
// .format() labels use ordinary spaces. Normalize so ranges read like every
// other label. Shared by the status timeline tooltips and the announcement
// window labels.
export function normalizeIntlSpaces(s: string): string {
  return s.replace(/[\u2009\u202f\u00a0]/g, " ");
}

// Format one instant with arbitrary options, degrading an invalid zone to UTC
// like the fixed-shape formatters above.
export function formatInZone(
  instant: Date,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(timeZone),
    ...opts,
  }).format(instant);
}

// Format a start–end range (spaces normalized), same invalid-zone degrade.
// formatRange collapses the shared parts ("Jul 7, 5:54 – 6:42 PM") and expands
// across a day boundary ("Jul 7, 11:50 PM – Jul 8, 12:20 AM").
export function formatRangeInZone(
  start: Date,
  end: Date,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions
): string {
  return normalizeIntlSpaces(
    new Intl.DateTimeFormat("en-US", {
      timeZone: safeZone(timeZone),
      ...opts,
    }).formatRange(start, end)
  );
}
