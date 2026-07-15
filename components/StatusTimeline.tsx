"use client";

import { memo, useState, type KeyboardEvent } from "react";
import {
  formatBarLabel,
  timelineSummary,
  STATUS_RANGE_MS,
  type StatusRangeKey,
  type AppStatus,
  type BarPoint,
} from "@/lib/status";

// Shared display primitives for the status pages: the uptime heartbeat strip,
// the live-state dot, and the small time/format helpers the /status rows and
// the per-service detail page (#150) both render. Extracted from StatusPage
// when the detail page became the second consumer.

// Display host (no scheme/path) for an app URL; falls back to the raw string.
export function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function relativeTime(from: number, now: number): string {
  const s = Math.max(0, Math.round((now - from) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// How long an outage has run, compact by scale so it fits a tight detail line:
// minutes under an hour ("3m"), hours+minutes under a day ("1h 12m"),
// days+hours beyond ("2d 4h").
export function downDuration(from: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - from) / 60_000));
  if (mins < 1) return "<1m"; // "for 0m" would read like a bug
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

// Absolute instant as date + clock time ("Jul 4, 5:04 PM") in the visitor's
// zone — outage starts/ends on both status pages. Same zone-with-UTC-fallback
// pattern as formatSince in lib/status.ts.
export function instantLabel(from: number, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).format(new Date(from));
  } catch {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(from));
  }
}

export function uptimeColor(u: number | null): string {
  // No-data bars read as clearly empty slots (much fainter than any colored
  // "has-data" bar) so gaps don't get mistaken for a red "down" reading.
  if (u == null) return "bg-fg/[0.06]";
  if (u >= 99.5) return "bg-emerald-400/80"; // perfect
  if (u >= 95) return "bg-emerald-400/55"; // a few blips
  if (u >= 75) return "bg-amber-400/70"; // degraded
  if (u >= 50) return "bg-orange-500/80"; // heavily degraded
  return "bg-red-400/75"; // mostly down
}

export function StateDot({ status }: { status: AppStatus | undefined }) {
  const cls = !status ? "bg-fg/25" : status.up ? "bg-emerald-400" : "bg-red-400";
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {status?.up && (
        <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-emerald-400/60" />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${cls}`} />
    </span>
  );
}

// Uptime heartbeat timeline (Atlassian Statuspage / UptimeRobot style). The
// server resamples every range into a fixed number of bars per strip — the
// row strips are TIMELINE_BARS long, the detail page's large graph DETAIL_BARS
// — so a strip is the same length with equally-sized pills whatever range is
// selected. Bars share the width evenly (flex-1) and fill the row. Tooltips
// read in the visitor's time zone (see formatBarLabel), matching the rest of
// the app.
//
// Memoized: the pages re-render every 10s for their "now" tick, but a strip's
// props only change on the 30s poll — without memo each tick would rebuild
// every strip's tooltip labels, the aria summary, and their Intl formatters
// for identical output.
export const StatusTimeline = memo(function StatusTimeline({
  points,
  timeZone,
  range,
  uptimePct,
  detail = false,
}: {
  points: BarPoint[];
  timeZone: string;
  // The range the strip is showing. Sets each bucket's width so a sub-day
  // bucket's tooltip labels the interval it spans, not a single instant.
  range: StatusRangeKey;
  // The displayed windowed uptime %, quoted in the strip's spoken summary so a
  // screen reader hears the same figure the page shows (the bucket-mean
  // fallback can drift a few tenths from it).
  uptimePct: number | null;
  // The detail page's large-graph variant: a taller strip, and hairline gaps
  // below sm so its 90 bars still fit a phone's width.
  detail?: boolean;
}) {
  // The bucket the keyboard/tap traversal is currently on, or null when idle.
  // One active index per strip (not per bar) keeps the strip a single tab stop:
  // arrows move this index, its bar shows a focus ring, and its detail is
  // announced/shown below. Cleared on Escape or blur.
  const [active, setActive] = useState<number | null>(null);
  if (points.length === 0) return null;
  // Each bar covers this slice of the range's window. Passed to formatBarLabel
  // so a sub-day bucket reads as a range ("Jul 7, 5:54 – 6:42 PM"); day-scale
  // bars ignore it and stay a single date.
  const bucketMs = STATUS_RANGE_MS[range] / points.length;
  // The detail line for one bar — the same text the mouse tooltip shows, reused
  // for the traversal's live region and its visible readout so keyboard, touch,
  // and screen-reader users all get exactly what a hover reveals.
  const bucketLabel = (p: BarPoint) =>
    p.uptime == null
      ? `${formatBarLabel(p.at, timeZone, bucketMs)}: no data`
      : `${formatBarLabel(p.at, timeZone, bucketMs)}: ${p.uptime.toFixed(1)}% up${
          // Append the bar's average latency when it recorded any up
          // check; omitted for bars with no latency sample.
          p.ms == null ? "" : ` · avg ${p.ms}ms`
        }`;
  // Arrow/Home/End move the active bucket; Escape clears it. One tab stop per
  // strip, chart-library style — the bars themselves never become tab stops.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null;
    if (e.key === "ArrowRight")
      next = active == null ? 0 : Math.min(points.length - 1, active + 1);
    else if (e.key === "ArrowLeft")
      next = active == null ? points.length - 1 : Math.max(0, active - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = points.length - 1;
    else if (e.key === "Escape") {
      if (active == null) return;
      e.preventDefault();
      setActive(null);
      return;
    } else return;
    e.preventDefault();
    setActive(next);
  };
  return (
    <div className="flex flex-col gap-1">
      {/* The strip is one tab stop with a whole-strip text alternative
          (timelineSummary) for screen readers; per-bucket detail comes from the
          arrow-key traversal below, not from dozens of focusable bars. */}
      <div
        role="img"
        aria-label={timelineSummary(points, timeZone, range, uptimePct)}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        className={`accent-focus flex items-stretch rounded-md border border-transparent outline-none ${
          detail ? "h-10 gap-px sm:h-12 sm:gap-[3px]" : "h-7 gap-[3px]"
        }`}
      >
        {points.map((p, i) => (
          // Position-unique key: bars are a fixed positional sequence, and two
          // buckets can share a minute-level `at`. A bare `p.at` key then
          // duplicates, corrupting reconciliation so a stale bar from the previous
          // range (e.g. 1h) lingers at the far end when switching views.
          <span
            key={`${p.at}-${i}`}
            title={bucketLabel(p)}
            // Tapping a bar is the touch path: it sets the active bucket (and
            // focuses the strip), surfacing the same label a hover would.
            onClick={() => setActive(i)}
            className={`min-w-0 flex-1 rounded-full ${uptimeColor(p.uptime)}${
              active === i ? " ring-2 ring-fg/70" : ""
            }`}
          />
        ))}
        {/* The strip is history only — no trailing live "now" cell. #113 added
            one (an active outage can average down to invisibility on long
            ranges), but whatever its shape it read as part of the data it
            wasn't part of (#137, then #141: removed). "Down right now" still
            shows on the row: the StateDot, the red detail line ("Unreachable
            for 23m" — which is also what screen readers get), and the ring. */}
      </div>
      {/* The active bucket's detail: announced (aria-live) and shown near the
          strip while traversing. Always mounted so the live region is stable;
          collapses to sr-only empty text when idle, so it reserves no space and
          says nothing until a bucket is picked. */}
      <p
        aria-live="polite"
        className={`text-xs text-fg/45 tabular-nums ${
          active == null ? "sr-only" : ""
        }`}
      >
        {active == null ? "" : bucketLabel(points[active])}
      </p>
    </div>
  );
});
