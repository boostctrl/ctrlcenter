"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import {
  summarize,
  statusMessage,
  type AppStatus,
  type StatusResponse,
  type AppHistory,
  type StatusHistory,
  type BarPoint,
  type UptimeWindows,
} from "@/lib/status";

export type StatusAppMeta = {
  id: string;
  name: string;
  icon: string;
  subtitle: string;
  url: string;
};

const POLL_MS = 30_000;

const RANGES = [
  { key: "h1", label: "1h" },
  { key: "d1", label: "24h" },
  { key: "d30", label: "30d" },
  { key: "d90", label: "90d" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

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

function uptimeColor(u: number | null): string {
  // No-data bars read as clearly empty slots (much fainter than any colored
  // "has-data" bar) so gaps don't get mistaken for a red "down" reading.
  if (u == null) return "bg-fg/[0.06]";
  if (u >= 99.5) return "bg-emerald-400/80";
  if (u >= 95) return "bg-emerald-400/55";
  if (u >= 80) return "bg-amber-400/70";
  return "bg-red-400/75";
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

// Format a BarPoint's `at` for the hover tooltip: a single poll ("…Thh:mm")
// shows HH:MM, an hour ("…Thh") shows an am/pm hour, a date shows the date.
function barLabel(at: string): string {
  if (at.length >= 16) return `${at.slice(0, 10)} ${at.slice(11, 16)}`;
  if (at.includes("T")) {
    const hh = Number(at.slice(11, 13));
    const day = at.slice(0, 10);
    return `${day} ${hh % 12 || 12}${hh < 12 ? "am" : "pm"}`;
  }
  return at;
}

// Uptime bar timeline (Atlassian Statuspage / UptimeRobot style). Hourly or
// daily bars depending on the selected range.
function Timeline({ points }: { points: BarPoint[] }) {
  if (points.length === 0) return null;
  return (
    <div className="flex h-7 items-stretch gap-0.5">
      {points.map((p, i) => (
        // Position-unique key: bars are a fixed positional sequence, and two
        // recent readings can share a minute-level `at`. A bare `p.at` key then
        // duplicates, corrupting reconciliation so a stale bar from the previous
        // range (e.g. 1h) lingers at the far end when switching views.
        <span
          key={`${p.at}-${i}`}
          title={
            p.uptime == null
              ? `${barLabel(p.at)}: no data`
              : `${barLabel(p.at)}: ${p.uptime.toFixed(1)}% up`
          }
          className={`flex-1 rounded ${uptimeColor(p.uptime)}`}
        />
      ))}
    </div>
  );
}

export default function StatusPage({ apps }: { apps: StatusAppMeta[] }) {
  const [statuses, setStatuses] = useState<Map<string, AppStatus>>(new Map());
  const [history, setHistory] = useState<Map<string, AppHistory>>(new Map());
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<RangeKey>("d1");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, historyRes] = await Promise.all([
        fetch("/api/status", { cache: "no-store" }),
        fetch("/api/status/history", { cache: "no-store" }),
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
  }, []);

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
  const rangeLabel = RANGES.find((r) => r.key === range)!.label;

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
          <div>
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-xs text-fg/40">Uptime over {rangeLabel}</span>
              <div className="flex overflow-hidden rounded-lg border border-fg/10">
                {RANGES.map((r) => (
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
            <p className="mt-1 px-1 text-[11px] text-fg/35">
              Oldest on the left, now on the right; faded bars are periods with no
              data.
            </p>
          </div>

          <div className="space-y-3">
            {apps.map((app) => {
              const s = statuses.get(app.id);
              const h = history.get(app.id);
              const uptime = h ? h.uptime[range as keyof UptimeWindows] : null;
              const dailyCount = range === "d30" ? 30 : 90;
              const series =
                range === "h1"
                  ? (h?.recent ?? [])
                  : range === "d1"
                    ? (h?.hourly ?? [])
                    : (h?.daily ?? []).slice(-dailyCount);
              const detail = !s
                ? "Checking…"
                : s.up
                  ? `${s.status ? `HTTP ${s.status}` : "Reachable"} · ${s.ms}ms`
                  : s.status
                    ? `Down · HTTP ${s.status}`
                    : "Unreachable";
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
                        {host(app.url)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular-nums">
                        {fmtPct(uptime)}
                      </p>
                      <p
                        className={`text-xs ${
                          s && !s.up ? "text-red-400" : "text-fg/45"
                        }`}
                      >
                        {detail}
                      </p>
                    </div>
                  </div>
                  {series.length > 0 && (
                    <div className="mt-3">
                      <Timeline points={series} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
