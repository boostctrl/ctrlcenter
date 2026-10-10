"use client";

import type { ServiceStatus } from "@/lib/monitor";
import type { AdguardSnapshot } from "@/lib/services/adguard";
import MonitorCard from "./MonitorCard";

// AdGuard Home's card on the Monitor page (#192): protection status, query
// volume and blocked share over the stats window, and the most blocked
// domains. Read-only — toggling protection is a 2.6.0 action.

// "45.2k" — compact, locale-independent count (locale formatting would
// hydrate differently between server and client).
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function AdguardCard({
  status,
}: {
  status: ServiceStatus<AdguardSnapshot>;
}) {
  const data = status.data;
  return (
    <MonitorCard title="AdGuard Home" status={status}>
      {data && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-lg font-semibold tabular-nums text-ink-90">
              {formatCount(data.totalQueries)}
              <span className="ml-1.5 text-xs font-normal text-ink-50">
                queries
              </span>
            </span>
            <span className="text-lg font-semibold tabular-nums text-ink-90">
              {formatCount(data.blocked)}
              <span className="ml-1.5 text-xs font-normal text-ink-50">
                blocked · {(data.blockedRatio * 100).toFixed(1)}%
              </span>
            </span>
          </div>
          <p className="text-xs text-ink-50">
            <span
              className={
                data.protectionEnabled ? "text-status-up/90" : "text-status-warning/90"
              }
            >
              {data.protectionEnabled
                ? "Protection on"
                : "Protection off — queries are not being filtered"}
            </span>
            {data.windowLabel && <> · {data.windowLabel}</>}
            {data.avgProcessingMs !== null && (
              <> · avg lookup {data.avgProcessingMs.toFixed(1)} ms</>
            )}
          </p>
          {data.topBlocked.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-medium tracking-wide text-ink-40 uppercase">
                Top blocked
              </p>
              <ul className="flex flex-col gap-1.5">
                {data.topBlocked.map((d) => (
                  <li
                    key={d.domain}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span
                      className="min-w-0 truncate text-sm text-ink-80"
                      title={d.domain}
                    >
                      {d.domain}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-50">
                      {formatCount(d.count)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </MonitorCard>
  );
}
