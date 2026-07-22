"use client";

import type { ReactNode } from "react";
import type { ServiceStatus } from "@/lib/monitor";
import { formatBytes } from "@/components/widgets/SystemStatsWidget";

// Shared chrome for one integration's card on the private Monitor page
// (#207): a glass card with the service name, a health dot, and the freshest
// error beside it. The dot reads green (data, no trouble), amber (stale —
// still showing the last good snapshot while the service isn't answering),
// or red (never answered).

export type CardHealth = "ok" | "stale" | "down";

export function cardHealth(
  status: Pick<ServiceStatus<unknown>, "data" | "error">
): CardHealth {
  if (status.data) return status.error ? "stale" : "ok";
  return "down";
}

const DOT: Record<CardHealth, string> = {
  ok: "bg-emerald-400",
  stale: "bg-amber-400",
  down: "bg-red-400",
};

export default function MonitorCard({
  title,
  status,
  children,
}: {
  title: string;
  status: ServiceStatus<unknown>;
  children?: ReactNode;
}) {
  const health = cardHealth(status);
  return (
    <section className="glass-card flex flex-col gap-4 p-6">
      <div className="flex items-baseline justify-between gap-3 border-b border-fg/10 pb-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg/90">
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${DOT[health]}`}
          />
          {title}
        </h2>
        {status.error && (
          <span
            className={`text-right text-xs ${
              health === "stale" ? "text-amber-400/90" : "text-red-400"
            }`}
          >
            {health === "stale" ? `Stale — ${status.error}` : status.error}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

// "1.2 MB/s" — rides the system-stats byte formatting so figures match.
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

// Compact remaining time: "1h 20m", "12m", "45s".
export function formatEta(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds)}s`;
}

// The thin accent progress bar, shared with the home grid's widgets — one
// definition (SystemStatsWidget's), re-exported for the monitor cards.
export { Meter } from "@/components/widgets/SystemStatsWidget";
