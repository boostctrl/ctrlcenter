"use client";

import { memo, useCallback, useEffect, useState, type KeyboardEvent } from "react";
import Icon from "./Icon";
import StatusAnnouncements from "./StatusAnnouncements";
import { useVisitorPrefs } from "./PrefsProvider";
import {
  summarize,
  statusMessage,
  formatBarLabel,
  timelineSummary,
  formatSince,
  STATUS_RANGES,
  STATUS_RANGE_MS,
  TIMELINE_BARS,
  type StatusRangeKey,
  type AppStatus,
  type StatusResponse,
  type AppHistory,
  type StatusHistory,
  type BarPoint,
  type UptimeWindows,
  type LatencyWindows,
} from "@/lib/status";
import type { StatusAnnouncement } from "@/lib/schema";

export type StatusAppMeta = {
  id: string;
  name: string;
  icon: string;
  subtitle: string;
  url: string;
};

const POLL_MS = 30_000;

// Display host (no scheme/path) for an app URL; falls back to the raw string.
function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function relativeTime(from: number, now: number): string {
  const s = Math.max(0, Math.round((now - from) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// How long the current outage has run, from its start to `now`, compact by scale
// so it fits the tight detail line: minutes under an hour ("3m"), hours+minutes
// under a day ("1h 12m"), days+hours beyond ("2d 4h"). Component-local like
// relativeTime.
function downDuration(from: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - from) / 60_000));
  if (mins < 1) return "<1m"; // "for 0m" would read like a bug
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

// Absolute start of the current outage for the detail line's tooltip: a date +
// clock time ("Jul 4, 5:04 PM") in the visitor's zone, so hovering "Down for
// 23m" reveals exactly when it began. Follows the same zone-with-UTC-fallback
// pattern as formatSince in lib/status.ts.
function downSinceLabel(from: number, timeZone: string): string {
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

function uptimeColor(u: number | null): string {
  // No-data bars read as clearly empty slots (much fainter than any colored
  // "has-data" bar) so gaps don't get mistaken for a red "down" reading.
  if (u == null) return "bg-fg/[0.06]";
  if (u >= 99.5) return "bg-emerald-400/80"; // perfect
  if (u >= 95) return "bg-emerald-400/55"; // a few blips
  if (u >= 75) return "bg-amber-400/70"; // degraded
  if (u >= 50) return "bg-orange-500/80"; // heavily degraded
  return "bg-red-400/75"; // mostly down
}

function StateDot({ status }: { status: AppStatus | undefined }) {
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
// server resamples every range into the same fixed number of bars (TIMELINE_BARS),
// so the strip is the same length with equally-sized pills whatever range is
// selected — the data under it changes, its shape doesn't. Bars share the width
// evenly (flex-1) and fill the row. Tooltips read in the visitor's time zone
// (see formatBarLabel), matching the rest of the app.
//
// Memoized: the page re-renders every 10s for its "now" tick, but a strip's
// props only change on the 30s poll — without memo each tick would rebuild
// every strip's ~30 tooltip labels, the aria summary, and their Intl
// formatters (×2, desktop + mobile mounts) for identical output.
const Timeline = memo(function Timeline({
  points,
  timeZone,
  range,
  live,
  uptimePct,
}: {
  points: BarPoint[];
  timeZone: string;
  // The range the strip is showing. Sets each bucket's width so a sub-day
  // bucket's tooltip labels the interval it spans, not a single instant.
  range: StatusRangeKey;
  // The live on-demand check's `up`, or undefined before the first check. Drives
  // the trailing "now" pill (below); separate from the historical bars, which
  // come from the background poller.
  live: boolean | undefined;
  // The row's displayed windowed uptime %, quoted in the strip's spoken summary
  // so a screen reader hears the same figure the column shows (the bucket-mean
  // fallback can drift a few tenths from it).
  uptimePct: number | null;
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
  const bucketMs = STATUS_RANGE_MS[range] / TIMELINE_BARS;
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
          arrow-key traversal below, not from thirty focusable bars. */}
      <div
        role="img"
        aria-label={timelineSummary(points, timeZone, range, live, uptimePct)}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        className="accent-focus flex h-7 items-stretch gap-[3px] rounded-md border border-transparent outline-none"
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
        {/* A dedicated "now" marker fed by the live on-demand check, not the
            historical buckets. It has to exist as its own cell for two reasons:
            the buckets can aggregate an active outage down to invisibility (a 90d
            strip buckets in ~3-day chunks, so a single down poll washes green),
            and the live status dot and the strip otherwise never meet — the dot
            says "down now" while the strip's newest bar can still read green.
            A small centered DOT, not another full-height pill (#137): same
            flex-1 shape as the bars read as a 31st, mysteriously brighter data
            bar. The circle borrows the app's dot-means-live-state language
            (dashboard cards, header row) and its fixed size plus the wider ml-2
            gap keep it unmistakably outside the history. Always rendered, even
            before the first check, so every row's strip ends the same way and
            the right edges line up. Live down pulses red — a 10px dot keeps
            that legible without the whole-cell flash that competed with the
            StateDot's ping — gated motion-safe so reduced-motion users get a
            static red dot. The dot's state is announced through the strip's
            summary label (", currently up/down"), so it needs no separate text
            alternative. */}
        <span
          title={
            live == null
              ? "Right now: checking…"
              : live
                ? "Right now: up"
                : "Right now: down"
          }
          className={`ml-2 h-2.5 w-2.5 shrink-0 self-center rounded-full ${
            live == null
              ? "bg-fg/20"
              : live
                ? "bg-emerald-400/90"
                : "bg-red-400 motion-safe:animate-pulse"
          }`}
        />
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

export default function StatusPage({
  apps,
  defaultRange,
  announcements,
}: {
  apps: StatusAppMeta[];
  defaultRange: StatusRangeKey;
  announcements: StatusAnnouncement[];
}) {
  const [statuses, setStatuses] = useState<Map<string, AppStatus>>(new Map());
  const [history, setHistory] = useState<Map<string, AppHistory>>(new Map());
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<StatusRangeKey>(defaultRange);
  // Render timeline times in the visitor's effective time zone, like the rest of
  // the app (the header clock, greeting), rather than UTC.
  const { timezone } = useVisitorPrefs();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, historyRes] = await Promise.all([
        fetch("/api/status", { cache: "no-store" }),
        // Pass the effective time zone so the daily timeline is bucketed by the
        // visitor's calendar day, not UTC.
        fetch(`/api/status/history?tz=${encodeURIComponent(timezone)}`, {
          cache: "no-store",
        }),
      ]);
      if (statusRes.ok) {
        const data: StatusResponse = await statusRes.json();
        setStatuses(new Map(data.results.map((d) => [d.id, d])));
        setCheckedAt(data.checkedAt);
        setNow(Date.now());
      }
      if (historyRes.ok) {
        const h: StatusHistory = await historyRes.json();
        setHistory(new Map(h.apps.map((a) => [a.id, a])));
      }
    } catch {
      // Leave the previous results in place on a network hiccup.
    } finally {
      setLoading(false);
    }
  }, [timezone]);

  useEffect(() => {
    // Initial fetch on mount; load() flips a loading flag synchronously, which
    // is the intended behavior here (kick off the first poll right away).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const { total, allUp } = summarize(
    apps.flatMap((a) => {
      const s = statuses.get(a.id);
      return s ? [s] : [];
    })
  );
  const downNames = apps
    .filter((a) => {
      const s = statuses.get(a.id);
      return s && !s.up;
    })
    .map((a) => a.name);
  const polled = checkedAt !== null && total > 0;
  const fmtPct = (u: number | null) => (u == null ? "—" : `${u.toFixed(1)}%`);
  const rangeLabel = STATUS_RANGES.find((r) => r.key === range)!.label;
  // The selected range's window length, used to judge whether an app's history
  // reaches back far enough to actually back its uptime % (see coverageSince
  // per app below). Same source as the toggle, so the two never disagree.
  const windowMs = STATUS_RANGE_MS[range];

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <div className="glass-card flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            className={`h-3 w-3 rounded-full ${
              !polled ? "bg-fg/25" : allUp ? "bg-emerald-400" : "bg-red-400"
            }`}
            aria-hidden
          />
          <div>
            <p className="font-semibold text-fg/90">
              {statusMessage(downNames, total)}
            </p>
            {checkedAt !== null && (
              <p className="text-xs text-fg/40">
                Updated {relativeTime(checkedAt, now)}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="shrink-0 rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/70 transition-colors hover:bg-fg/10 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Maintenance/upcoming-change notices sit between the summary and the
          rows (the Statuspage pattern, per #118): a planned red patch on a
          timeline below has its story directly above it. */}
      <StatusAnnouncements announcements={announcements} />

      {/* Per-app rows */}
      {apps.length === 0 ? (
        <p className="text-fg/40">No applications to monitor yet.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-xs text-fg/40">Uptime over {rangeLabel}</span>
            <div className="flex overflow-hidden rounded-lg border border-fg/10">
              {STATUS_RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={range === r.key}
                  onClick={() => setRange(r.key)}
                  className={`px-2.5 py-1 text-xs transition-colors ${
                    range === r.key
                      ? "bg-fg/15 text-fg"
                      : "text-fg/50 hover:text-fg/80"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {apps.map((app) => {
              const s = statuses.get(app.id);
              const h = history.get(app.id);
              const uptime = h ? h.uptime[range as keyof UptimeWindows] : null;
              // The selected range's average latency, keyed exactly like uptime
              // (the range keys are a subset of the window keys). Null when the
              // range recorded no up-check latency — we render nothing then.
              const latency = h ? h.latency[range as keyof LatencyWindows] : null;
              const series = h?.series[range] ?? [];
              // How far back this app's data reaches, but only when it's
              // materially short of the selected window — the data misses more
              // than 5% of the window's head, so the uptime % covers less range
              // than the toggle claims (an app watched five minutes reads
              // "100.0%" over 90d). Null when there's no data at all (since is
              // null; the % already renders "—") or when coverage is ≥95% of the
              // window, so a nearly-full window isn't cluttered with the note.
              const coverageSince =
                h && h.since != null && h.since - (now - windowMs) > windowMs * 0.05
                  ? h.since
                  : null;
              // The current outage's start as the poller recorded it, but only
              // when the live check also says down. The live dot/detail come
              // from the on-demand /api/status check while downSince comes from
              // the background poller, so for a poll or two they can disagree
              // (the live check flips first). When the poller hasn't recorded
              // this outage yet (downSince null) we keep the plain wording rather
              // than fabricate a duration. `now` ticks, so the duration updates.
              const outageStart =
                s && !s.up && h?.downSince != null ? h.downSince : null;
              const dur = outageStart != null ? downDuration(outageStart, now) : null;
              const detail = !s
                ? "Checking…"
                : s.up
                  ? `${s.status ? `HTTP ${s.status}` : "Reachable"} · ${s.ms}ms`
                  : dur
                    ? s.status
                      ? `Down for ${dur} · HTTP ${s.status}`
                      : `Unreachable for ${dur}`
                    : s.status
                      ? `Down · HTTP ${s.status}`
                      : "Unreachable";
              // The uptime % + live detail, used in two places: the fixed-width
              // right column from sm up, and the second row below sm.
              const figures = (
                <>
                  {/* Uptime % and its range-average latency share one line
                      (#137) — the % anchors it in semibold, the latency trails
                      muted, so a healthy mature app's column is two lines, not
                      four. flex-wrap lets an outsized latency value wrap under
                      the % (still right-aligned) instead of truncating the
                      fixed w-32 column. Latency renders only when the range has
                      a sample, so a range with no latency data shows nothing
                      (not a dash). */}
                  <p className="flex flex-wrap items-baseline justify-end gap-x-1 tabular-nums">
                    <span className="font-semibold">{fmtPct(uptime)}</span>
                    {latency && (
                      <span className="text-xs text-fg/45">
                        · avg {latency.avg} ms
                      </span>
                    )}
                  </p>
                  {/* How far back the data actually reaches, shown only when the
                      selected range asks for a longer window than exists (see
                      coverageSince above). One short muted line like "since Jul
                      4" ("since 5:04 PM" for the 1h range). Kept as visible text
                      rather than folded into a tooltip: the at-a-glance honesty
                      of a young app's "100.0%" is the whole point of #112, and
                      tooltips are exactly the mouse-only channel #116 retired. */}
                  {coverageSince != null && (
                    <p className="text-xs text-fg/45">
                      since {formatSince(coverageSince, timezone, range)}
                    </p>
                  )}
                  <p
                    // Absolute outage start on hover, in the visitor's zone, so
                    // "Down for 23m" reveals exactly when it began.
                    title={
                      outageStart != null
                        ? `down since ${downSinceLabel(outageStart, timezone)}`
                        : undefined
                    }
                    // Wraps rather than truncates: an hour-scale outage's
                    // "Unreachable for 11h 23m" overflows the w-32 column, and
                    // cutting off the duration hides exactly the number this
                    // line exists to show (#137).
                    className={`text-xs ${
                      s && !s.up ? "text-red-400" : "text-fg/45"
                    }`}
                  >
                    {detail}
                  </p>
                </>
              );
              // One strip element for both layouts (like `figures` above), so
              // the desktop and mobile mounts can't drift apart prop by prop.
              const timeline = series.length > 0 && (
                <Timeline
                  points={series}
                  timeZone={timezone}
                  range={range}
                  live={s?.up}
                  uptimePct={uptime}
                />
              );
              return (
                <div
                  key={app.id}
                  className={`glass-card px-5 py-4 ${
                    s && !s.up ? "ring-1 ring-red-400/30" : ""
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <StateDot status={s} />
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fg/5 ring-1 ring-fg/10">
                      <Icon icon={app.icon} name={app.name} size={24} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-fg/90">
                        {app.name}
                      </p>
                      <p className="truncate text-sm text-fg/55">
                        {app.subtitle
                          ? `${app.subtitle} · ${host(app.url)}`
                          : host(app.url)}
                      </p>
                    </div>
                    {/* Heartbeat sits inline with the rest of the row on wider
                        screens (left of the uptime figure); it drops to its own
                        line below sm where there's no room for it. */}
                    {timeline && (
                      <div className="hidden shrink-0 sm:block sm:w-44 lg:w-72">
                        {timeline}
                      </div>
                    )}
                    {/* Fixed width so the heartbeat's right edge — and thus the
                        whole strip — lands in the same place on every row,
                        regardless of how wide the uptime figure or detail text
                        is. Only from sm up: below that the strip wraps anyway,
                        so the reserved 128px only squeezed the name to a stub
                        ("Home A…") — there the figures move to the second row
                        and the name gets the full width (#110). */}
                    <div className="hidden w-32 shrink-0 text-right sm:block">
                      {figures}
                    </div>
                  </div>
                  <div className="mt-3 flex items-end gap-4 sm:hidden">
                    <div className="min-w-0 flex-1">{timeline}</div>
                    <div className="shrink-0 text-right">{figures}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
