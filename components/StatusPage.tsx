"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { useVisitorPrefs } from "./PrefsProvider";
import {
  summarize,
  statusMessage,
  formatBarLabel,
  formatSince,
  STATUS_RANGES,
  STATUS_RANGE_MS,
  type StatusRangeKey,
  type AppStatus,
  type StatusResponse,
  type AppHistory,
  type StatusHistory,
  type BarPoint,
  type UptimeWindows,
  type LatencyWindows,
} from "@/lib/status";

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
  return `${Math.round(s / 60)}m ago`;
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
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
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
function Timeline({
  points,
  timeZone,
  live,
}: {
  points: BarPoint[];
  timeZone: string;
  // The live on-demand check's `up`, or undefined before the first check. Drives
  // the trailing "now" pill (below); separate from the historical bars, which
  // come from the background poller.
  live: boolean | undefined;
}) {
  if (points.length === 0) return null;
  return (
    <div className="flex h-7 items-stretch gap-[3px]">
      {points.map((p, i) => (
        // Position-unique key: bars are a fixed positional sequence, and two
        // buckets can share a minute-level `at`. A bare `p.at` key then
        // duplicates, corrupting reconciliation so a stale bar from the previous
        // range (e.g. 1h) lingers at the far end when switching views.
        <span
          key={`${p.at}-${i}`}
          title={
            p.uptime == null
              ? `${formatBarLabel(p.at, timeZone)}: no data`
              : `${formatBarLabel(p.at, timeZone)}: ${p.uptime.toFixed(1)}% up${
                  // Append the bar's average latency when it recorded any up
                  // check; omitted for bars with no latency sample.
                  p.ms == null ? "" : ` · avg ${p.ms}ms`
                }`
          }
          className={`min-w-0 flex-1 rounded-full ${uptimeColor(p.uptime)}`}
        />
      ))}
      {/* A dedicated "now" pill fed by the live on-demand check, not the
          historical buckets. It has to exist as its own cell for two reasons:
          the buckets can aggregate an active outage down to invisibility (a 90d
          strip buckets in ~3-day chunks, so a single down poll washes green),
          and the live status dot and the strip otherwise never meet — the dot
          says "down now" while the strip's newest bar can still read green. Set
          off from the history by a slightly wider gap (ml-1 over the strip's
          gap-[3px]). Always rendered, even before the first check, so every
          row's strip stays the same length and the right edges line up. Live
          down pulses in a strong red so it's unmissable at every range. */}
      <span
        title={
          live == null
            ? "Right now: checking…"
            : live
              ? "Right now: up"
              : "Right now: down"
        }
        className={`ml-1 min-w-0 flex-1 rounded-full ${
          live == null
            ? "bg-fg/[0.06]"
            : live
              ? "bg-emerald-400/80"
              : "bg-red-400/90 animate-pulse"
        }`}
      />
    </div>
  );
}

export default function StatusPage({
  apps,
  defaultRange,
}: {
  apps: StatusAppMeta[];
  defaultRange: StatusRangeKey;
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
                  <p className="font-semibold tabular-nums">{fmtPct(uptime)}</p>
                  {/* How far back the data actually reaches, shown only when the
                      selected range asks for a longer window than exists (see
                      coverageSince above). One short muted line like "since Jul
                      4" ("since 5:04 PM" for the 1h range), matching the latency
                      line below; fits the fixed w-32 column without widening it. */}
                  {coverageSince != null && (
                    <p className="text-xs text-fg/45">
                      since {formatSince(coverageSince, timezone, range)}
                    </p>
                  )}
                  {/* Range average latency, directly under the uptime % it pairs
                      with. One compact line; rendered only when the range has a
                      sample, so a range with no latency data shows nothing (not a
                      dash). Fits the fixed w-32 column without widening it. */}
                  {latency && (
                    <p className="text-xs text-fg/45 tabular-nums">
                      avg {latency.avg} ms
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
                    className={`truncate text-xs ${
                      s && !s.up ? "text-red-400" : "text-fg/45"
                    }`}
                  >
                    {detail}
                  </p>
                </>
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
                    {series.length > 0 && (
                      <div className="hidden shrink-0 sm:block sm:w-44 lg:w-72">
                        <Timeline points={series} timeZone={timezone} live={s?.up} />
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
                    <div className="min-w-0 flex-1">
                      {series.length > 0 && (
                        <Timeline points={series} timeZone={timezone} live={s?.up} />
                      )}
                    </div>
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
