"use client";

import Link from "next/link";
import { STATE_DOT, Meter, type ServiceState } from "./MonitorCard";

// One service's complication on the Monitor face (#208): a compact, clickable
// dashboard tile sharing the cockpit's dot vocabulary — service name, a headline
// metric, an optional sub-line, and a thin gauge where the headline is a ratio.
// A configured service links to its detail page; an unused one (disabled / not
// set up) dims and links to Settings, so the face keeps its shape whether one
// service or all nine are running.

export default function Complication({
  label,
  state,
  metric,
  sub,
  meter,
  href,
}: {
  label: string;
  state: ServiceState;
  metric: string;
  sub?: string;
  // 0..1, present only for ratio-headline services (capacity, blocked share, …).
  meter?: number;
  href: string;
}) {
  const dim = state === "disabled" || state === "unconfigured";
  // In-use services grow to fill their band; an off / not-set-up one stays a
  // compact chip so it never dominates a row you aren't using.
  const sizing = dim ? "grow-0 basis-44" : "grow basis-44";
  return (
    <Link
      href={href}
      className={`flex min-h-[6.75rem] flex-col gap-1 rounded-xl border border-fg/10 bg-fg/[0.02] p-4 transition-colors hover:border-fg/20 hover:bg-fg/[0.05] ${sizing} ${
        dim ? "opacity-45 hover:opacity-80" : ""
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[state]}`}
        />
        <span className="truncate text-[11px] font-medium tracking-wide text-fg/40 uppercase">
          {label}
        </span>
      </span>
      <span
        className="mt-0.5 truncate text-lg font-semibold text-fg/90 sm:text-xl"
        title={metric}
      >
        {metric}
      </span>
      {sub && <span className="truncate text-xs text-fg/45">{sub}</span>}
      {/* The gauge sits at the tile's foot so every tile's baseline aligns. */}
      {meter !== undefined && (
        <div className="mt-auto pt-2">
          <Meter percent={Math.min(100, Math.max(0, meter * 100))} />
        </div>
      )}
    </Link>
  );
}
