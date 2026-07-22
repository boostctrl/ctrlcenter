"use client";

import type { ServiceStatus } from "@/lib/monitor";
import type { TruenasSnapshot, TruenasPool } from "@/lib/services/truenas";
import { formatBytes } from "@/components/widgets/SystemStatsWidget";
import MonitorCard, { Meter } from "./MonitorCard";

// TrueNAS's card on the Monitor page (#193): per-pool health and capacity, and
// the active alerts (SMART failures, replication problems, …). Read-only by
// design — TrueNAS write actions are permanently out of scope.

function PoolRow({ pool }: { pool: TruenasPool }) {
  return (
    <li className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm text-fg/80">
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${
              pool.healthy ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
          <span className="truncate" title={pool.name}>
            {pool.name}
          </span>
          <span
            className={`text-xs ${
              pool.healthy ? "text-fg/45" : "text-red-400"
            }`}
          >
            {pool.status}
          </span>
        </span>
        {pool.usedRatio !== null && (
          <span className="shrink-0 text-xs tabular-nums text-fg/50">
            {(pool.usedRatio * 100).toFixed(0)}% used
            {pool.free !== null && <> · {formatBytes(pool.free)} free</>}
          </span>
        )}
      </div>
      {pool.usedRatio !== null && <Meter percent={pool.usedRatio * 100} />}
    </li>
  );
}

export default function TruenasCard({
  status,
}: {
  status: ServiceStatus<TruenasSnapshot>;
}) {
  const data = status.data;
  return (
    <MonitorCard title="TrueNAS" status={status}>
      {data && (
        <>
          {data.pools.length > 0 ? (
            <ul className="divide-y divide-fg/10">
              {data.pools.map((p, i) => (
                <PoolRow key={`${p.name}-${i}`} pool={p} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg/40">No pools reported.</p>
          )}
          {data.alerts.length > 0 && (
            <ul className="flex flex-col gap-1 border-t border-fg/10 pt-3">
              {data.alerts.map((a, i) => (
                <li
                  key={`${a.message}-${i}`}
                  className={`text-xs ${
                    a.level === "critical" ? "text-red-400" : "text-amber-400/90"
                  }`}
                >
                  {a.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </MonitorCard>
  );
}
