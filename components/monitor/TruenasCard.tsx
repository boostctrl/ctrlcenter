"use client";

import type { ServiceStatus } from "@/lib/monitor";
import type {
  TruenasSnapshot,
  TruenasPool,
  TruenasApp,
  TruenasContainer,
} from "@/lib/services/truenas";
import { formatBytes } from "@/components/widgets/SystemStatsWidget";
import MonitorCard, { Meter } from "./MonitorCard";

// TrueNAS's card on the Monitor page (#193): per-pool health and capacity, the
// apps running on its Docker engine (SCALE 24.10+), and the active alerts (SMART
// failures, replication problems, …). Read-only by design — TrueNAS write
// actions are permanently out of scope.

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

// Running apps read green; a crash is red, a transitional state amber, anything
// else (stopped/unknown) a muted grey — matching the pool health dots.
function appDot(app: TruenasApp): string {
  if (app.running) return "bg-emerald-400";
  if (app.state === "CRASHED") return "bg-red-400";
  if (app.state === "DEPLOYING" || app.state === "STOPPING") return "bg-amber-400";
  return "bg-fg/25";
}

// A container's state dot: running is green, a stopped/exited one red, anything
// transitional or unknown muted — the same vocabulary as the app and pool dots.
function containerDot(state: string): string {
  if (state === "running") return "bg-emerald-400";
  if (state === "exited" || state === "dead" || state === "stopped") return "bg-red-400";
  return "bg-fg/25";
}

function ContainerRow({ container }: { container: TruenasContainer }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-xs">
      <span className="flex min-w-0 items-center gap-2 text-fg/65">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${containerDot(container.state)}`}
        />
        <span className="truncate" title={container.name}>
          {container.name}
        </span>
      </span>
      {container.image && (
        <span
          className="max-w-[45%] shrink-0 truncate text-fg/35"
          title={container.image}
        >
          {container.image}
        </span>
      )}
    </li>
  );
}

function AppRow({ app }: { app: TruenasApp }) {
  const hasContainers = app.containerList.length > 0;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm text-fg/80">
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${appDot(app)}`}
          />
          <span className="truncate" title={app.name}>
            {app.name}
          </span>
          {!app.running && (
            <span
              className={`shrink-0 text-xs ${
                app.state === "CRASHED" ? "text-red-400" : "text-fg/45"
              }`}
            >
              {app.state.toLowerCase()}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-baseline gap-2 text-xs tabular-nums text-fg/50">
          {app.upgradeAvailable && (
            <span className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-200/90 uppercase">
              update
            </span>
          )}
          {/* When we can list the containers below, the count is redundant. */}
          {!hasContainers && app.containers !== null && (
            <span>
              {app.containers} container{app.containers === 1 ? "" : "s"}
            </span>
          )}
        </span>
      </div>
      {hasContainers && (
        <ul className="flex flex-col gap-1 border-l border-fg/10 pl-3">
          {app.containerList.map((c, i) => (
            <ContainerRow key={`${c.name}-${i}`} container={c} />
          ))}
        </ul>
      )}
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
          {data.apps.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-fg/10 pt-3">
              <p className="text-[11px] font-medium tracking-wide text-fg/40 uppercase">
                Apps
              </p>
              <ul className="flex flex-col gap-3">
                {data.apps.map((a, i) => (
                  <AppRow key={`${a.name}-${i}`} app={a} />
                ))}
              </ul>
            </div>
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
