"use client";

import Link from "next/link";
import { STATE_DOT, type ServiceState } from "./state";
import type { GlanceVisual } from "./glances";
import { DayStrip, SegmentBar, Sparkline } from "./kit/charts";

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
  fill = false,
  center,
  caption,
  ring,
  alert,
  lines,
  visual,
}: {
  label: string;
  state: ServiceState;
  // Where the tile leads; without one it's a plain tile (a public board tile,
  // #301).
  href?: string;
  // Fill its container (a board's grid cell) instead of sizing itself for
  // the Monitor face's flex rows.
  fill?: boolean;
  center: string;
  caption: string;
  // 0..1 gauge fill; omitted → a plain number badge (no decorative ring).
  ring?: number;
  alert?: boolean;
  lines: string[];
  visual?: GlanceVisual;
}) {
  const dim = state === "disabled" || state === "unconfigured";
  // In-use tiles flow up to three per row on wide screens (two on tablets, one
  // on phones) and grow to fill, so a group of five lays out as a clean 3 + 2.
  // An off / not-set-up tile stays a compact chip that doesn't grow, so a
  // service you aren't using (e.g. Portainer) collapses out of the way instead
  // of claiming an equal slot. It recedes through the surface (no fill, no
  // shadow, dashed edge) rather than whole-tile opacity, which dragged its text
  // down to ~1.6:1 contrast (#273).
  const sizing = fill
    ? "w-full"
    : dim
      ? "grow-0 basis-60"
      : "grow basis-full sm:basis-[calc(50%-0.375rem)] lg:basis-[calc(33.333%-0.5rem)]";
  const className = `glass-card flex min-h-[7rem] items-center gap-4 p-4 ${sizing} ${
    dim ? "[--surface-bg:transparent] [--surface-border-style:dashed] [--surface-shadow:none]" : ""
  }`;
  // The name and lines come first in the markup and the gauge is drawn
  // before them, so a screen reader announces the service before its
  // numbers: "Portainer, 2 stopped …, 13 running" (#518).
  const body = (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[state]}`}
          />
          <span className="truncate text-[11px] font-medium tracking-wide text-ink-40 uppercase">
            {label}
          </span>
          {/* The dot's amber alone doesn't say it (#518). */}
          {state === "stale" && (
            <span className="shrink-0 text-[11px] font-medium tracking-wide text-status-warning uppercase">
              · Stale
            </span>
          )}
        </span>
        {lines.map((text, i) => (
          <span
            key={i}
            className={`truncate ${
              i === 0 ? "text-sm font-semibold text-ink-90" : "text-xs text-ink-45"
            }`}
            title={text}
          >
            {text}
          </span>
        ))}
        {visual && <Visual visual={visual} />}
      </div>
      <span className="order-first flex shrink-0">
        {ring !== undefined ? (
          <Gauge state={state} center={center} caption={caption} ring={ring} alert={alert} />
        ) : (
          <NumberBadge center={center} caption={caption} alert={alert} />
        )}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
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
    ? "text-status-down"
    : state === "stale"
      ? "text-status-warning"
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
        <span className="truncate text-[15px] font-bold text-ink-90">{center}</span>
        {caption && (
          <span className="mt-0.5 truncate text-[7px] font-medium tracking-wide text-ink-40 uppercase">
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
        className={`truncate text-3xl font-bold ${alert ? "text-status-down" : "text-ink-90"}`}
      >
        {center}
      </span>
      {caption && (
        <span className="mt-1 truncate text-[8px] font-medium tracking-wide text-ink-40 uppercase">
          {caption}
        </span>
      )}
    </span>
  );
}

function Visual({ visual }: { visual: GlanceVisual }) {
  if (visual.kind === "spark") return <Sparkline data={visual.values} className="mt-1.5 h-4 w-full" />;
  if (visual.kind === "days") return <DayStrip values={visual.values} className="mt-1.5 h-5 gap-1" />;
  return <SegmentBar parts={visual.parts} className="mt-2 h-1.5" />;
}
