"use client";

import Link from "next/link";
import { STATE_DOT, type ServiceState } from "./MonitorCard";
import type { GlanceVisual, SegmentTone } from "./glances";

// One service's complication on the Monitor face (#208, #223, #226): a compact
// clickable tile with a headline on the left — a ring gauge where a real
// proportion exists, otherwise a plain number badge — a status dot + label and
// one to three stat lines on the right, and a *purposeful* visual (a query
// sparkline, a next-7-days strip, or a request breakdown bar) where the service
// has one. A configured service links to its detail page; an unused one dims and
// links to Settings, so the face keeps its shape whether one service or all nine
// are running. Purely presentational — the content comes from the glance.

export default function Complication({
  label,
  state,
  href,
  center,
  caption,
  ring,
  alert,
  lines,
  visual,
}: {
  label: string;
  state: ServiceState;
  href: string;
  center: string;
  caption: string;
  // 0..1 gauge fill; omitted → a plain number badge (no decorative ring).
  ring?: number;
  alert?: boolean;
  lines: string[];
  visual?: GlanceVisual;
}) {
  const dim = state === "disabled" || state === "unconfigured";
  // Tiles flow up to three per row on wide screens (two on tablets, one on
  // phones) and grow to fill, so a group of five lays out as a clean 3 + 2 and a
  // group of two splits the row evenly — whichever services are in use.
  const sizing =
    "grow basis-full sm:basis-[calc(50%-0.375rem)] lg:basis-[calc(33.333%-0.5rem)]";
  return (
    <Link
      href={href}
      className={`flex min-h-[7rem] items-center gap-4 rounded-xl border border-fg/10 bg-fg/[0.02] p-4 transition-colors hover:border-fg/20 hover:bg-fg/[0.05] ${sizing} ${
        dim ? "opacity-45 hover:opacity-80" : ""
      }`}
    >
      {ring !== undefined ? (
        <Gauge state={state} center={center} caption={caption} ring={ring} alert={alert} />
      ) : (
        <NumberBadge center={center} caption={caption} alert={alert} />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[state]}`}
          />
          <span className="truncate text-[11px] font-medium tracking-wide text-fg/40 uppercase">
            {label}
          </span>
        </span>
        {lines.map((text, i) => (
          <span
            key={i}
            className={`truncate ${
              i === 0 ? "text-sm font-semibold text-fg/90" : "text-xs text-fg/45"
            }`}
            title={text}
          >
            {text}
          </span>
        ))}
        {visual && <Visual visual={visual} />}
      </div>
    </Link>
  );
}

// The ring gauge: a track circle under a fill arc, with the center token and its
// caption overlaid. r = 15.9155 makes the circumference ≈ 100, so the fill dash
// array is simply `${percent} 100`. The arc uses currentColor so its tone
// (accent / amber / red) is set by a single text-color class.
function Gauge({
  state,
  center,
  caption,
  ring,
  alert,
}: {
  state: ServiceState;
  center: string;
  caption: string;
  ring: number;
  alert?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, ring * 100));
  const tone = alert
    ? "text-red-400"
    : state === "stale"
      ? "text-amber-400"
      : "text-[var(--accent-from)]";
  return (
    <span className="relative inline-flex h-16 w-16 shrink-0 items-center justify-center">
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90">
        <circle
          cx="18"
          cy="18"
          r="15.9155"
          fill="none"
          className="text-fg/10"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <circle
          cx="18"
          cy="18"
          r="15.9155"
          fill="none"
          className={tone}
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${pct} 100`}
        />
      </svg>
      <span className="flex max-w-[3.25rem] flex-col items-center leading-none">
        <span className="truncate text-[15px] font-bold text-fg/90">{center}</span>
        {caption && (
          <span className="mt-0.5 truncate text-[7px] font-medium tracking-wide text-fg/40 uppercase">
            {caption}
          </span>
        )}
      </span>
    </span>
  );
}

// The plain number badge for a count service (no measured proportion): a bold
// figure over its caption, in the same footprint as the gauge so readouts align.
function NumberBadge({
  center,
  caption,
  alert,
}: {
  center: string;
  caption: string;
  alert?: boolean;
}) {
  return (
    <span className="flex h-16 w-16 shrink-0 flex-col items-center justify-center leading-none">
      <span
        className={`truncate text-3xl font-bold ${alert ? "text-red-400" : "text-fg/90"}`}
      >
        {center}
      </span>
      {caption && (
        <span className="mt-1 truncate text-[8px] font-medium tracking-wide text-fg/40 uppercase">
          {caption}
        </span>
      )}
    </span>
  );
}

const SEGMENT_BG: Record<SegmentTone, string> = {
  pending: "bg-amber-400/80",
  processing: "bg-sky-400/70",
  available: "bg-emerald-400/70",
};

// The purposeful bottom visual, chosen per service so it always means something.
function Visual({ visual }: { visual: GlanceVisual }) {
  if (visual.kind === "spark") return <Sparkline data={visual.values} />;
  if (visual.kind === "days") return <DayStrip values={visual.values} />;
  if (visual.kind === "bars") return <RatioBars values={visual.values} />;
  return <SegmentBar parts={visual.parts} />;
}

// A minimal trend line for a per-unit series (AdGuard query volume). Normalized
// to its own max and drawn full-width under the readouts.
function Sparkline({ data }: { data: number[] }) {
  const pts = data.slice(-32);
  const max = Math.max(...pts, 1);
  const w = 100;
  const h = 18;
  const step = pts.length > 1 ? w / (pts.length - 1) : w;
  const points = pts
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
      className="mt-1.5 h-4 w-full text-[var(--accent-from)]"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// A next-7-days bar strip (Sonarr/Radarr upcoming): one bar per day, height by
// count; empty days are a faint baseline so the cadence reads at a glance.
function DayStrip({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div aria-hidden className="mt-1.5 flex h-5 items-end gap-1">
      {values.map((v, i) => (
        <span
          key={i}
          className={`flex-1 rounded-sm ${v > 0 ? "bg-[var(--accent-from)]" : "bg-fg/15"}`}
          style={{ height: `${v > 0 ? Math.max(20, (v / max) * 100) : 12}%` }}
        />
      ))}
    </div>
  );
}

// Per-item capacity bars (TrueNAS pools): each bar's height is its absolute
// fill (0..1, not normalized), so a near-full pool reads tall and turns red —
// unlike the activity strip, where heights are relative to the busiest day.
function RatioBars({ values }: { values: number[] }) {
  return (
    <div aria-hidden className="mt-1.5 flex h-5 items-end gap-1">
      {values.map((v, i) => {
        const pct = Math.min(100, Math.max(0, v * 100));
        return (
          <span
            key={i}
            className={`flex-1 rounded-sm ${v >= 0.9 ? "bg-red-400/80" : "bg-[var(--accent-from)]"}`}
            style={{ height: `${Math.max(8, pct)}%` }}
          />
        );
      })}
    </div>
  );
}

// A stacked breakdown bar (Seerr pending/processing/available). A thin rail with
// a colored segment per bucket, sized by share; an all-zero total shows the rail.
function SegmentBar({ parts }: { parts: { value: number; tone: SegmentTone }[] }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  return (
    <div
      aria-hidden
      className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-fg/10"
    >
      {total > 0 &&
        parts.map(
          (p, i) =>
            p.value > 0 && (
              <span
                key={i}
                className={SEGMENT_BG[p.tone]}
                style={{ width: `${(p.value / total) * 100}%` }}
              />
            )
        )}
    </div>
  );
}
