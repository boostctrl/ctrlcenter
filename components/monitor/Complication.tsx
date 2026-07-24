"use client";

import Link from "next/link";
import { STATE_DOT, type ServiceState } from "./MonitorCard";

// One service's complication on the Monitor face (#208, #223): an instrument
// "dial" — a ring gauge with a center readout on the left, a status dot + label
// and one to three stat lines on the right, and an optional sparkline. A
// configured service links to its detail page; an unused one (disabled / not set
// up) dims and links to Settings, so the face keeps its shape whether one
// service or all nine are running. The gauge/readout content comes from each
// service's glance extractor; this component is purely presentational.

export default function Complication({
  label,
  state,
  href,
  center,
  caption,
  ring,
  alert,
  lines,
  spark,
}: {
  label: string;
  state: ServiceState;
  href: string;
  center: string;
  caption: string;
  // 0..1 fill; omitted → a soft decorative ring (pure-count services).
  ring?: number;
  alert?: boolean;
  lines: string[];
  spark?: number[];
}) {
  const dim = state === "disabled" || state === "unconfigured";
  // In-use services grow to fill their band; an off / not-set-up one stays a
  // compact chip so it never dominates a row you aren't using.
  const sizing = dim ? "grow-0 basis-56" : "grow basis-64";
  return (
    <Link
      href={href}
      className={`flex min-h-[7rem] items-center gap-4 rounded-xl border border-fg/10 bg-fg/[0.02] p-4 transition-colors hover:border-fg/20 hover:bg-fg/[0.05] ${sizing} ${
        dim ? "opacity-45 hover:opacity-80" : ""
      }`}
    >
      <Gauge state={state} center={center} caption={caption} ring={ring} alert={alert} />
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
              i === 0
                ? "text-sm font-semibold text-fg/90"
                : "text-xs text-fg/45"
            }`}
            title={text}
          >
            {text}
          </span>
        ))}
        {spark && spark.length > 1 && <Sparkline data={spark} />}
      </div>
    </Link>
  );
}

// The ring gauge: a track circle under a fill arc, with the center token and its
// caption overlaid. Using r = 15.9155 makes the circumference ≈ 100, so the fill
// dash array is simply `${percent} 100`. The arc uses currentColor so its tone
// (accent / amber / red / muted-decorative) is set by a single text-color class.
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
  ring?: number;
  alert?: boolean;
}) {
  const decorative = ring === undefined;
  const pct = Math.min(100, Math.max(0, (ring ?? 1) * 100));
  const tone = alert
    ? "text-red-400"
    : state === "stale"
      ? "text-amber-400"
      : state === "unreachable"
        ? "text-red-400"
        : decorative
          ? "text-fg/25"
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
          className={`${tone} ${decorative ? "opacity-40" : ""}`}
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

// A minimal trend line for a per-unit series (AdGuard query volume). Normalized
// to its own max and drawn full-width under the readouts; non-scaling stroke so
// it stays crisp when the viewBox stretches.
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
      className="mt-1 h-4 w-full text-[var(--accent-from)]"
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
