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
        <span className="flex min-w-0 items-center gap-2 text-sm text-ink-80">
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${
              pool.healthy ? "bg-status-up" : "bg-status-down"
            }`}
          />
          <span className="truncate" title={pool.name}>
            {pool.name}
          </span>
          <span
            className={`text-xs ${
              pool.healthy ? "text-ink-45" : "text-status-down"
            }`}
          >
            {pool.status}
          </span>
        </span>
        {pool.usedRatio !== null && (
          <span className="shrink-0 text-xs tabular-nums text-ink-50">
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
  if (app.running) return "bg-status-up";
  if (app.state === "CRASHED") return "bg-status-down";
  if (app.state === "DEPLOYING" || app.state === "STOPPING") return "bg-status-warning";
  return "bg-fg/25";
}

// A container's state dot: running is green, a stopped/exited one red, anything
// transitional or unknown muted — the same vocabulary as the app and pool dots.
function containerDot(state: string): string {
  if (state === "running") return "bg-status-up";
  if (state === "exited" || state === "dead" || state === "stopped") return "bg-status-down";
  return "bg-fg/25";
}

function ContainerRow({ container }: { container: TruenasContainer }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-xs">
      <span className="flex min-w-0 items-center gap-2 text-ink-65">
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
          className="max-w-[45%] shrink-0 truncate text-ink-45"
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
        <span className="flex min-w-0 items-center gap-2 text-sm text-ink-80">
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
                app.state === "CRASHED" ? "text-status-down" : "text-ink-45"
              }`}
            >
              {app.state.toLowerCase()}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-baseline gap-2 text-xs tabular-nums text-ink-50">
          {app.upgradeAvailable && (
            <span className="rounded border border-status-warning/30 bg-status-warning/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-status-warning/90 uppercase">
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
          {/* Alerts lead — a SMART failure or degraded pool is the whole point
              of glancing at TrueNAS, so it can't sit buried under the app list. */}
          {data.alerts.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {data.alerts.map((a, i) => (
                <li
                  key={`${a.message}-${i}`}
                  className={`flex items-baseline gap-2 rounded-lg border px-3 py-2 text-xs ${
                    a.level === "critical"
                      ? "border-status-down/30 bg-status-down/10 text-status-down"
                      : "border-status-warning/30 bg-status-warning/10 text-status-warning/90"
                  }`}
                >
                  <span aria-hidden className="shrink-0 font-semibold uppercase">
                    {a.level === "critical" ? "Critical" : "Warning"}
                  </span>
                  <span className="min-w-0">{a.message}</span>
                </li>
              ))}
            </ul>
          )}
          {data.pools.length > 0 ? (
            <ul className="divide-y divide-fg/10">
              {data.pools.map((p, i) => (
                <PoolRow key={`${p.name}-${i}`} pool={p} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-40">No pools reported.</p>
          )}
          {data.apps.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-fg/10 pt-3">
              <p className="text-[11px] font-medium tracking-wide text-ink-40 uppercase">
                Apps
              </p>
              {/* Two independent columns on wide screens so the roster fills the
                  width; each column packs its own rows, so an app with a
                  container sub-list doesn't leave a gap beside a plain one. */}
              <div className="grid gap-x-12 gap-y-3 sm:grid-cols-2 sm:gap-y-0">
                {(() => {
                  const mid = Math.ceil(data.apps.length / 2);
                  return [data.apps.slice(0, mid), data.apps.slice(mid)].map(
                    (col, ci) => (
                      <ul key={ci} className="flex flex-col gap-3">
                        {col.map((a, i) => (
                          <AppRow key={`${a.name}-${i}`} app={a} />
                        ))}
                      </ul>
                    )
                  );
                })()}
              </div>
            </div>
          )}
        </>
      )}
    </MonitorCard>
  );
}
