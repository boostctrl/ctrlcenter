"use client";

import type { ServiceStatus } from "@/lib/monitor";
import type { AdguardSnapshot } from "@/lib/services/adguard";
import AdguardCard, { formatCount } from "../AdguardCard";

// AdGuard's detail page body (#223): the card's current-state summary (protection,
// totals, top-blocked) plus a trend chart of query volume and blocked queries
// across the stats window — drawn from the per-unit series AdGuard already
// returns in its stats payload, so it costs no extra request.

const W = 320;
const H = 96;

// Build the SVG path for a series: an area (closed to the baseline) or a line.
function seriesPath(values: number[], max: number, area: boolean): string {
  const n = values.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0);
  const y = (v: number) => H - (max > 0 ? (v / max) * (H - 6) : 0);
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  if (!area) return `M${line.join(" L")}`;
  return `M0,${H} L${line.join(" L")} L${W},${H} Z`;
}

function TrendChart({
  series,
  blockedSeries,
  windowLabel,
}: {
  series: number[];
  blockedSeries: number[];
  windowLabel: string | null;
}) {
  if (series.length < 2) {
    return <p className="text-sm text-fg/40">Not enough data yet for a trend.</p>;
  }
  const max = Math.max(...series, 1);
  const peak = Math.max(...series);
  const hasBlocked = blockedSeries.length === series.length;
  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden
        className="h-32 w-full"
      >
        <defs>
          <linearGradient id="adguard-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-from)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent-from)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={seriesPath(series, max, true)} fill="url(#adguard-fill)" />
        <path
          d={seriesPath(series, max, false)}
          fill="none"
          stroke="var(--accent-from)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {hasBlocked && (
          <path
            d={seriesPath(blockedSeries, max, false)}
            fill="none"
            className="text-red-400"
            stroke="currentColor"
            strokeOpacity="0.7"
            strokeWidth="1.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-fg/45">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--accent-from)]" />
            queries
          </span>
          {hasBlocked && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-400/70" />
              blocked
            </span>
          )}
        </span>
        <span className="tabular-nums">
          peak {formatCount(peak)}
          {windowLabel && <> · {windowLabel}</>}
        </span>
      </div>
    </div>
  );
}

export default function AdguardDetail({
  status,
}: {
  status: ServiceStatus<AdguardSnapshot>;
}) {
  const data = status.data;
  return (
    // Summary and trend sit side by side on wide screens so the page fills the
    // width with content rather than stacking two half-empty bands.
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <AdguardCard status={status} />
      {data && (
        <section className="glass-card flex flex-col gap-3 p-6">
          <h2 className="text-[15px] font-semibold text-fg/90">Query activity</h2>
          <TrendChart
            series={data.series}
            blockedSeries={data.blockedSeries}
            windowLabel={data.windowLabel}
          />
        </section>
      )}
    </div>
  );
}
