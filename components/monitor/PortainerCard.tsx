"use client";

import type { ServiceStatus } from "@/lib/monitor";
import type {
  PortainerSnapshot,
  PortainerEndpoint,
} from "@/lib/services/portainer";
import MonitorCard from "./MonitorCard";

// Portainer's card on the Monitor page (#197): container states grouped by
// environment — the health signal for the apps with no API of their own.
// Read-only — start/stop/restart are 2.6.0 actions.

function EndpointRow({ endpoint }: { endpoint: PortainerEndpoint }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-sm text-fg/80" title={endpoint.name}>
        {endpoint.name}
      </span>
      {endpoint.hasSnapshot ? (
        <span className="flex shrink-0 items-baseline gap-2 text-xs tabular-nums">
          <span className="text-emerald-400/90">{endpoint.running} up</span>
          {endpoint.stopped > 0 && (
            <span className="text-fg/50">{endpoint.stopped} stopped</span>
          )}
          {endpoint.unhealthy > 0 && (
            <span className="text-red-400">{endpoint.unhealthy} unhealthy</span>
          )}
        </span>
      ) : (
        <span className="shrink-0 text-xs text-fg/40">no snapshot</span>
      )}
    </li>
  );
}

export default function PortainerCard({
  status,
}: {
  status: ServiceStatus<PortainerSnapshot>;
}) {
  const data = status.data;
  return (
    <MonitorCard title="Portainer" status={status}>
      {data && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-lg font-semibold tabular-nums text-fg/90">
              {data.totals.running}
              <span className="ml-1.5 text-xs font-normal text-fg/50">
                running
              </span>
            </span>
            <span className="text-xs text-fg/50">
              {data.totals.stopped} stopped
              {data.totals.unhealthy > 0 && (
                <span className="text-red-400">
                  {" "}
                  · {data.totals.unhealthy} unhealthy
                </span>
              )}{" "}
              · {data.totals.total} total
            </span>
          </div>
          {data.endpoints.length > 0 ? (
            <ul className="flex flex-col gap-1.5 border-t border-fg/10 pt-3">
              {data.endpoints.map((e, i) => (
                <EndpointRow key={`${e.name}-${i}`} endpoint={e} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg/40">No environments.</p>
          )}
        </>
      )}
    </MonitorCard>
  );
}
