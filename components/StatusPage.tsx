"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { summarize, type AppStatus, type StatusResponse } from "@/lib/status";

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

function StateDot({ status }: { status: AppStatus | undefined }) {
  const cls = !status
    ? "bg-fg/25"
    : status.up
      ? "bg-emerald-400"
      : "bg-red-400";
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {status?.up && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${cls}`} />
    </span>
  );
}

export default function StatusPage({ apps }: { apps: StatusAppMeta[] }) {
  const [statuses, setStatuses] = useState<Map<string, AppStatus>>(new Map());
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) return;
      const data: StatusResponse = await res.json();
      setStatuses(new Map(data.results.map((d) => [d.id, d])));
      setCheckedAt(data.checkedAt);
      setNow(Date.now());
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

  return (
    <div className="space-y-6">
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
        <div className="space-y-3">
          {apps.map((app) => {
            const s = statuses.get(app.id);
            const detail = !s
              ? "Checking…"
              : s.up
                ? `${s.status ? `HTTP ${s.status}` : "Reachable"} · ${s.ms}ms`
                : "Unreachable";
            return (
              <div
                key={app.id}
                className={`glass-card flex items-center gap-4 px-5 py-4 ${
                  s && !s.up ? "ring-1 ring-red-400/30" : ""
                }`}
              >
                <StateDot status={s} />
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fg/5 ring-1 ring-fg/10">
                  <Icon icon={app.icon} name={app.name} size={24} />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-fg/90">{app.name}</p>
                  <p className="truncate text-sm text-fg/40">{host(app.url)}</p>
                </div>
                <div
                  className={`ml-auto shrink-0 text-right text-sm ${
                    s && !s.up ? "text-red-400" : "text-fg/50"
                  }`}
                >
                  {detail}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
