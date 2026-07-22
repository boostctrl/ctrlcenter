"use client";

import type { ServiceStatus } from "@/lib/monitor";
import type { UnifiSnapshot } from "@/lib/services/unifi";
import MonitorCard from "./MonitorCard";

// UniFi's card on the Monitor page (#194): internet/WAN status as the
// headline, then the connected-client count and UniFi device health, then any
// derived issues. Read-only.

export default function UnifiCard({
  status,
}: {
  status: ServiceStatus<UnifiSnapshot>;
}) {
  const data = status.data;
  return (
    <MonitorCard title="UniFi" status={status}>
      {data && (
        <>
          <div className="flex items-baseline gap-2">
            <span
              aria-hidden
              className={`h-2.5 w-2.5 shrink-0 self-center rounded-full ${
                data.internet.up ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
            <span className="text-lg font-semibold text-fg/90">
              {data.internet.up ? "Internet up" : "Internet down"}
            </span>
            {data.internet.isp && (
              <span className="text-sm text-fg/50">· {data.internet.isp}</span>
            )}
          </div>
          <p className="text-xs text-fg/50">
            {data.internet.wanIp ?? "no WAN IP"}
            {data.internet.latencyMs !== null && (
              <> · {data.internet.latencyMs} ms latency</>
            )}
          </p>

          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-fg/10 pt-3">
            <span className="text-sm text-fg/80">
              <span className="text-base font-semibold tabular-nums text-fg/90">
                {data.clients.total}
              </span>{" "}
              client{data.clients.total === 1 ? "" : "s"}
              <span className="text-fg/45">
                {" "}
                ({data.clients.wireless} WiFi · {data.clients.wired} wired
                {data.clients.guests > 0 && <> · {data.clients.guests} guest</>})
              </span>
            </span>
          </div>
          <p className="text-xs text-fg/50">
            {data.devices.adopted} device{data.devices.adopted === 1 ? "" : "s"} online
            {data.devices.disconnected > 0 && (
              <span className="text-red-400">
                {" "}
                · {data.devices.disconnected} offline
              </span>
            )}
            {data.devices.pending > 0 && (
              <span className="text-amber-400/90">
                {" "}
                · {data.devices.pending} pending
              </span>
            )}
          </p>

          {data.issues.length > 0 && (
            <ul className="flex flex-col gap-1 border-t border-fg/10 pt-3">
              {data.issues.map((issue, i) => (
                <li
                  key={`${issue.message}-${i}`}
                  className={`text-xs ${
                    issue.level === "error" ? "text-red-400" : "text-amber-400/90"
                  }`}
                >
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </MonitorCard>
  );
}
