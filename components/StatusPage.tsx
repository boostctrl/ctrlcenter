"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import StatusAnnouncements from "./StatusAnnouncements";
import { ChipGroup } from "./ChipGroup";
import { useVisitorPrefs } from "./PrefsProvider";
import {
  StatusTimeline,
  StateDot,
  host,
  relativeTime,
  downDuration,
  instantLabel,
} from "./StatusTimeline";
import {
  summarize,
  statusMessage,
  formatSince,
  STATUS_RANGES,
  STATUS_RANGE_MS,
  type StatusRangeKey,
  type AppStatus,
  type StatusResponse,
  type AppHistory,
  type StatusHistory,
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
            <ChipGroup
              label="Uptime range"
              size="xs"
              options={STATUS_RANGES.map((r) => ({
                value: r.key,
                label: r.label,
              }))}
              value={range}
              onChange={setRange}
            />
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
                        ? `down since ${instantLabel(outageStart, timezone)}`
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
                <StatusTimeline
                  points={series}
                  timeZone={timezone}
                  range={range}
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
                      {/* The identity block links to the per-service detail
                          view (#150) — the name, not the whole card, so the
                          strip's tap/keyboard traversal stays its own thing. */}
                      <Link
                        href={`/status/${app.id}`}
                        aria-label={`${app.name} — uptime details`}
                        className="accent-focus rounded-sm outline-none"
                      >
                        <p className="truncate font-semibold text-fg/90 underline-offset-4 hover:underline">
                          {app.name}
                        </p>
                      </Link>
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
