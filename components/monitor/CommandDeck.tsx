"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { History } from "@/lib/monitor-history";
import { usePolling } from "@/components/usePolling";
import type { MonitorEntry, MonitorSnapshot } from "@/lib/monitor";
import { formatBytes, formatSpeed } from "@/lib/format";
import { serviceState, STATE_DOT, type ServiceState } from "./state";
import { arrWeek, tileContent } from "./glances";
import { formatCount, Glyph, Sparkline, TONE_TEXT, type Tone } from "./kit";

// The Monitor's command deck (#520, after the health bar of #208 and #509):
// the whole homelab read at once, before the eye reaches any one tile. A
// status ring with one arc per integration, colored by its state (red where
// its tile alerts), around
// the count that are answering; beside it the verdict and the totals across
// services; under it whatever needs attention, each linking to the page
// that shows it. Everything is derived from the snapshot the tiles render,
// in the same state vocabulary, so an arc means what a tile's dot means.

const page = (id: string) => `/admin/monitor/${encodeURIComponent(id)}`;

const STATE_ARC: Record<ServiceState, string> = {
  live: "text-status-up",
  stale: "text-status-warning",
  unreachable: "text-status-down",
  disabled: "text-fg/25",
  unconfigured: "text-fg/15",
};
const STATE_WORD: Record<ServiceState, string> = {
  live: "live",
  stale: "stale",
  unreachable: "offline",
  disabled: "off",
  unconfigured: "not set up",
};

// The ring: an arc per integration in the configured order, a hairline
// inside it and a slow ring of ticks outside (stilled with the rest of the
// page's motion), and a glow in the verdict's color behind it all.
function StatusCore({
  entries,
  online,
  tone,
}: {
  entries: { label: string; state: ServiceState; alert: boolean }[];
  online: number;
  tone: Tone;
}) {
  const R = 50;
  const C = 2 * Math.PI * R;
  const n = entries.length;
  const slot = n > 0 ? C / n : C;
  const gap = n > 1 ? Math.min(5, slot * 0.18) : 0;
  const glow = tone === "down" ? "bg-status-down" : tone === "warn" ? "bg-status-warning" : tone === "up" ? "bg-status-up" : "bg-fg";
  return (
    <div
      role="img"
      aria-label={n > 0 ? `${online} of ${n} services answering` : "No services connected"}
      className="relative mx-auto h-44 w-44 shrink-0 lg:h-48 lg:w-48"
    >
      <span aria-hidden className={`absolute inset-6 rounded-full opacity-25 blur-2xl ${glow}`} />
      <svg aria-hidden viewBox="0 0 120 120" className="absolute inset-0 h-full w-full">
        <circle
          cx="60"
          cy="60"
          r="58"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="0.6 5.47"
          className="animate-spin-slow origin-center text-fg/30"
        />
        <circle cx="60" cy="60" r="41" fill="none" stroke="currentColor" strokeWidth="0.75" className="text-fg/15" />
        <g transform="rotate(-90 60 60)">
          {n === 0 ? (
            <circle cx="60" cy="60" r={R} fill="none" stroke="currentColor" strokeWidth="7" className="text-fg/10" />
          ) : (
            entries.map((e, i) => (
              <circle
                key={i}
                cx="60"
                cy="60"
                r={R}
                fill="none"
                stroke="currentColor"
                strokeWidth="7"
                strokeDasharray={`${(slot - gap).toFixed(2)} ${(C - slot + gap).toFixed(2)}`}
                strokeDashoffset={(-(i * slot) - gap / 2).toFixed(2)}
                // Red where its tile's gauge is: answering, but with trouble.
                className={e.alert ? "text-status-down" : STATE_ARC[e.state]}
              />
            ))
          )}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-4xl font-bold tracking-tight tabular-nums text-ink-90">
          {online}
          {n > 0 && <span className="text-lg font-semibold text-ink-45">/{n}</span>}
        </span>
        <span className="mt-1.5 text-[10px] font-semibold tracking-[0.18em] text-ink-50 uppercase">
          {n > 0 ? "online" : "connected"}
        </span>
      </div>
    </div>
  );
}

type Vital = { label: string; value: string; sub?: string; tone?: Tone; href: string; trend?: number[] };

// The reading each total's trend line follows over the last hour (#530),
// summed across the integrations of its type (the fullest pool for TrueNAS).
const TREND: Partial<Record<MonitorEntry["type"], { key: string; combine: "sum" | "max" }>> = {
  qbittorrent: { key: "down", combine: "sum" },
  tautulli: { key: "streams", combine: "sum" },
  unifi: { key: "clients", combine: "sum" },
  truenas: { key: "used", combine: "max" },
  portainer: { key: "running", combine: "sum" },
  seerr: { key: "pending", combine: "sum" },
};
type Trends = Partial<Record<MonitorEntry["type"], number[]>>;

// The last hour of each trend, fetched once a minute for the integrations
// that answer. Empty until the first fetch, and for a type with fewer than
// two readings.
function useTrends(snapshot: MonitorSnapshot): Trends {
  const [trends, setTrends] = useState<Trends>({});
  const wanted = snapshot.filter((e) => TREND[e.type] && e.data !== null).map((e) => `${e.type}:${e.id}`).join(",");
  const load = useCallback(
    async (signal: AbortSignal) => {
      const pairs = wanted ? wanted.split(",").map((w) => w.split(":") as [MonitorEntry["type"], string]) : [];
      const got = await Promise.all(
        pairs.map(async ([type, id]) => {
          try {
            const res = await fetch(`/api/monitor/${encodeURIComponent(id)}/history?range=hour`, { signal });
            return res.ok ? { type, history: (await res.json()) as History } : null;
          } catch {
            return null;
          }
        })
      );
      if (signal.aborted) return;
      // Combined per minute; a minute nobody recorded stays empty rather
      // than reading as zero.
      const combined: Partial<Record<MonitorEntry["type"], (number | null)[]>> = {};
      for (const hit of got) {
        if (!hit) continue;
        const rule = TREND[hit.type]!;
        const values = hit.history.series[rule.key];
        if (!values) continue;
        const prev = combined[hit.type];
        combined[hit.type] = values.map((v, i) => {
          const p = prev?.[i] ?? null;
          if (v === null) return p;
          if (p === null) return v;
          return rule.combine === "max" ? Math.max(p, v) : p + v;
        });
      }
      // The line runs from the first reading to the last, holding its value
      // over a gap; it needs two readings to say anything.
      const next: Trends = {};
      for (const [type, values] of Object.entries(combined) as [MonitorEntry["type"], (number | null)[]][]) {
        const first = values.findIndex((v) => v !== null);
        const last = values.length - 1 - [...values].reverse().findIndex((v) => v !== null);
        if (first < 0 || last - first < 1) continue;
        let held = values[first] as number;
        next[type] = values.slice(first, last + 1).map((v) => (held = v ?? held));
      }
      setTrends(next);
    },
    [wanted]
  );
  usePolling(load, 60_000);
  return trends;
}

// The totals across every integration of a type (#300), for the types that
// have answered; each links to the first of its type.
function vitalsOf(snapshot: MonitorSnapshot, now: number | null, trends: Trends = {}): Vital[] {
  const ofType = <K extends MonitorEntry["type"]>(type: K) =>
    snapshot.filter((e): e is Extract<MonitorEntry, { type: K }> => e.type === type && e.data !== null);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const out: Vital[] = [];

  const qb = ofType("qbittorrent");
  if (qb.length) {
    const downloading = sum(qb.map((e) => e.data!.counts.downloading));
    out.push({
      label: "Downloads",
      value: `↓ ${formatSpeed(sum(qb.map((e) => e.data!.downSpeed)))}`,
      sub: `↑ ${formatSpeed(sum(qb.map((e) => e.data!.upSpeed)))} · ${downloading} active`,
      href: page(qb[0].id),
      trend: trends.qbittorrent,
    });
  }
  const tt = ofType("tautulli");
  if (tt.length) {
    const streams = sum(tt.map((e) => e.data!.streamCount));
    const transcodes = sum(tt.map((e) => e.data!.transcodeCount));
    out.push({
      label: "Streams",
      value: String(streams),
      sub: streams === 0 ? "Nothing playing" : transcodes > 0 ? `${transcodes} transcoding` : "All direct",
      href: page(tt[0].id),
      trend: trends.tautulli,
    });
  }
  const ag = ofType("adguard");
  if (ag.length) {
    const queries = sum(ag.map((e) => e.data!.totalQueries));
    const blocked = sum(ag.map((e) => e.data!.totalQueries * e.data!.blockedRatio));
    const off = ag.some((e) => !e.data!.protectionEnabled);
    out.push({
      label: "DNS queries",
      value: formatCount(queries),
      sub: off ? "Protection off" : `${queries > 0 ? Math.round((blocked / queries) * 100) : 0}% blocked`,
      tone: off ? "down" : undefined,
      href: page(ag[0].id),
    });
  }
  const un = ofType("unifi");
  if (un.length) {
    const down = un.some((e) => !e.data!.internet.up);
    const lost = sum(un.map((e) => e.data!.devices.disconnected));
    out.push({
      label: "Network",
      value: `${sum(un.map((e) => e.data!.clients.total))} clients`,
      sub: down ? "Internet down" : lost > 0 ? `${lost} device${lost === 1 ? "" : "s"} down` : "Internet up",
      tone: down ? "down" : lost > 0 ? "warn" : undefined,
      href: page(un[0].id),
      trend: trends.unifi,
    });
  }
  const tn = ofType("truenas");
  if (tn.length) {
    const pools = tn.flatMap((e) => e.data!.pools);
    const fullest = pools.length ? Math.max(...pools.map((p) => p.usedRatio ?? 0)) : null;
    out.push({
      label: "Storage",
      value: `${formatBytes(sum(pools.map((p) => p.free ?? 0)))} free`,
      sub: fullest !== null ? `Fullest pool ${Math.round(fullest * 100)}%` : undefined,
      tone: fullest !== null && fullest >= 0.9 ? "down" : fullest !== null && fullest >= 0.8 ? "warn" : undefined,
      href: page(tn[0].id),
      trend: trends.truenas,
    });
  }
  const pt = ofType("portainer");
  if (pt.length) {
    const running = sum(pt.map((e) => e.data!.totals.running));
    const total = sum(pt.map((e) => e.data!.totals.total));
    const unhealthy = sum(pt.map((e) => e.data!.totals.unhealthy));
    out.push({
      label: "Containers",
      value: `${running}/${total}`,
      sub: unhealthy > 0 ? `${unhealthy} unhealthy` : "running",
      tone: unhealthy > 0 ? "down" : undefined,
      href: page(pt[0].id),
      trend: trends.portainer,
    });
  }
  const sr = ofType("seerr");
  if (sr.length) {
    const pending = sum(sr.map((e) => e.data!.pending));
    out.push({
      label: "Requests",
      value: `${pending} waiting`,
      sub: `${sum(sr.map((e) => e.data!.processing))} processing`,
      href: page(sr[0].id),
      trend: trends.seerr,
    });
  }
  const arrs = [...ofType("sonarr"), ...ofType("radarr")];
  if (arrs.length) {
    out.push({
      label: "Library",
      // Empty until mounted: the week is counted in the viewer's zone.
      value: now === null ? "–" : String(sum(arrs.map((e) => arrWeek(e.data!, now).thisWeek))),
      sub: "grabbed or imported this week",
      href: page(arrs[0].id),
    });
  }
  return out;
}

export default function CommandDeck({ snapshot, now }: { snapshot: MonitorSnapshot; now: number | null }) {
  const entries = snapshot.map((e) => ({
    label: e.label,
    state: serviceState(e),
    alert: tileContent(e, now, "admin").alert === true,
  }));
  const n = (s: ServiceState) => entries.filter((x) => x.state === s).length;
  const live = n("live");
  const stale = n("stale");
  const offline = n("unreachable");
  const disabled = n("disabled");
  const connected = live + stale + offline;

  const alerts = snapshot.flatMap((e) => (e.type === "truenas" ? (e.data?.alerts ?? []) : []));
  const attention = offline > 0 || alerts.some((a) => a.level === "critical");
  const tone: Tone = attention ? "down" : stale > 0 ? "warn" : connected > 0 ? "up" : "muted";
  const verdict = attention
    ? "Attention needed"
    : stale > 0
      ? "Running degraded"
      : connected > 0
        ? "All systems normal"
        : "No integrations connected";

  // What's wrong, each linking to the page that shows it: the TrueNAS
  // alerts, then any integration that can't be reached (#509).
  const problems: { tone: "down" | "warn"; message: string; source: string; href: string }[] = [
    ...snapshot.flatMap((e) =>
      e.type === "truenas"
        ? (e.data?.alerts ?? []).map((a) => ({
            tone: a.level === "critical" ? ("down" as const) : ("warn" as const),
            message: a.message,
            source: e.label,
            href: page(e.id),
          }))
        : []
    ),
    ...snapshot
      .filter((e) => serviceState(e) === "unreachable")
      .map((e) => ({
        tone: "down" as const,
        message: e.error ? `Can't reach it: ${e.error}` : "Can't reach it",
        source: e.label,
        href: page(e.id),
      })),
  ];
  const showProblems = (attention || stale > 0) && problems.length > 0;
  const PROBLEM_CAP = 5;
  const summary = attention
    ? [offline ? `${offline} offline` : null, alerts.length ? `${alerts.length} alert${alerts.length === 1 ? "" : "s"}` : null]
        .filter(Boolean)
        .join(" · ")
    : connected === 0
      ? "Connect a service in Settings to get started."
      : `${connected} of ${snapshot.length} integrations connected`;
  const trends = useTrends(snapshot);
  const vitals = vitalsOf(snapshot, now, trends);
  const legend: [ServiceState, number][] = [
    ["live", live],
    ["stale", stale],
    ["unreachable", offline],
    ["disabled", disabled],
  ];

  return (
    <section aria-label="System health" className="glass-card flex flex-col overflow-hidden [--surface-lift:0px]">
      <div className="grid gap-x-10 gap-y-6 p-6 lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-center lg:p-8">
        <StatusCore entries={entries} online={live + stale} tone={tone} />

        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold tracking-[0.18em] text-ink-50 uppercase">System status</p>
              <h2 className={`mt-1 text-2xl font-bold tracking-tight sm:text-3xl ${tone === "muted" ? "text-ink-90" : TONE_TEXT[tone]}`}>
                {verdict}
              </h2>
              <p className="mt-1 text-sm text-ink-55">{summary}</p>
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-60">
              {legend.map(
                ([state, count]) =>
                  count > 0 && (
                    <li key={state} className="inline-flex items-center gap-1.5">
                      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[state]}`} />
                      <span className="tabular-nums">
                        {count} {STATE_WORD[state]}
                      </span>
                    </li>
                  )
              )}
            </ul>
          </div>

          {vitals.length > 0 && (
            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {vitals.map((v) => (
                <li key={v.label} className="min-w-0">
                  <Link
                    href={v.href}
                    className="block h-full rounded-[var(--control-radius)] border-l-2 border-[color-mix(in_srgb,var(--accent-from)_55%,transparent)] bg-fg/[0.04] px-3.5 py-2.5 transition-colors hover:bg-fg/[0.08]"
                  >
                    <span className="block truncate text-[10px] font-semibold tracking-[0.14em] text-ink-50 uppercase">
                      {v.label}
                    </span>
                    <span className="mt-0.5 block truncate text-lg font-semibold tracking-tight tabular-nums text-ink-90">
                      {v.value}
                    </span>
                    {v.sub && (
                      <span className={`block truncate text-xs ${v.tone ? TONE_TEXT[v.tone] : "text-ink-50"}`}>{v.sub}</span>
                    )}
                    {/* The last hour, when there's a line to draw (#530). */}
                    {v.trend && <Sparkline data={v.trend} points={60} area className="mt-1.5 h-5 w-full" />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showProblems && (
        <ul className="divide-y divide-fg/[0.07] border-t border-fg/[0.07]">
          {problems.slice(0, PROBLEM_CAP).map((p, i) => (
            <li key={`${p.href}-${i}`}>
              <Link href={p.href} className="flex items-center gap-3 px-6 py-3 transition-colors hover:bg-fg/[0.03] lg:px-8">
                <span className={`shrink-0 ${TONE_TEXT[p.tone]}`}>
                  <Glyph name={p.tone === "down" ? "error" : "alert"} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-sm text-ink-85" title={p.message}>
                    {/* The icon's color says how bad; a screen reader hears it (#518). */}
                    <span className="sr-only">{p.tone === "down" ? "Critical: " : "Warning: "}</span>
                    {p.message}
                  </span>
                  <span className="block text-xs text-ink-50">{p.source}</span>
                </span>
                <span className="shrink-0 text-ink-40">
                  <Glyph name="chevron" />
                </span>
              </Link>
            </li>
          ))}
          {problems.length > PROBLEM_CAP && (
            <li className="px-6 py-2.5 text-xs text-ink-50 lg:px-8">and {problems.length - PROBLEM_CAP} more</li>
          )}
        </ul>
      )}
    </section>
  );
}
