"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import {
  summarize,
  type AppStatus,
  type StatusResponse,
  type AppHistory,
  type StatusHistory,
  type TimelinePoint,
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
  { key: "d1", label: "24h" },
  { key: "d7", label: "7d" },
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
  if (u == null) return "bg-fg/15";
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

// 90-day daily uptime timeline (Atlassian Statuspage / UptimeRobot style).
function Timeline({ points }: { points: TimelinePoint[] }) {
  if (points.length === 0) return null;
  return (
    <div className="flex h-6 items-stretch gap-px">
      {points.map((p) => (
        <span
          key={p.date}
          title={
            p.uptime == null
              ? `${p.date}: no data`
              : `${p.date}: ${p.uptime.toFixed(1)}% up`
          }
          className={`flex-1 rounded-[1px] ${uptimeColor(p.uptime)}`}
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
  const [range, setRange] = useState<RangeKey>("d90");

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

  const { down, total, allUp } = summarize(
    apps.flatMap((a) => {
      const s = statuses.get(a.id);
      return s ? [s] : [];
    })
  );
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
              {!polled
                ? "Checking services…"
                : allUp
                  ? "All systems operational"
                  : `${down} of ${total} ${down === 1 ? "service" : "services"} down`}
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

          <div className="space-y-3">
            {apps.map((app) => {
              const s = statuses.get(app.id);
              const h = history.get(app.id);
              const uptime = h ? h.uptime[range as keyof UptimeWindows] : null;
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
                  {h && h.timeline.length > 0 && (
                    <div className="mt-3">
                      <Timeline points={h.timeline} />
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
