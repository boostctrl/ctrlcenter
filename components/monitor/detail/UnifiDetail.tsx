"use client";

import type { ServiceStatus } from "@/lib/monitor";
import type { UnifiDetail as UnifiDetailData, UnifiDevice } from "@/lib/services/unifi";
import UnifiCard from "../UnifiCard";

// UniFi's detail page body (#231): the card's internet/client/health summary
// plus the adopted-device list — which access points, switches, and gateways
// exist, whether each is up, and how many clients it carries. That inventory is
// the depth the health-count card can't show.

// Compact uptime: "5d 4h", "12h", "34m".
function uptimeLabel(seconds: number | null): string {
  if (seconds === null) return "";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h`;
  return `${Math.max(1, Math.floor(seconds / 60))}m`;
}

function DeviceRow({ device }: { device: UnifiDevice }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <span className="flex min-w-0 items-center gap-2 text-sm text-fg/80">
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${
            device.up ? "bg-emerald-400" : "bg-red-400"
          }`}
        />
        <span className="truncate" title={device.name}>
          {device.name}
        </span>
        <span className="shrink-0 text-xs text-fg/45">{device.kind}</span>
      </span>
      <span className="flex shrink-0 items-baseline gap-3 text-xs tabular-nums text-fg/50">
        {device.up ? (
          <>
            <span>
              {device.clients} client{device.clients === 1 ? "" : "s"}
            </span>
            {device.uptime !== null && <span>up {uptimeLabel(device.uptime)}</span>}
          </>
        ) : (
          <span className="text-red-400">offline</span>
        )}
      </span>
    </li>
  );
}

export default function UnifiDetail({
  status,
}: {
  status: ServiceStatus<UnifiDetailData>;
}) {
  const devices = status.data?.deviceList ?? [];
  // Split the roster across two columns on wide screens so it fills the width
  // instead of one tall list flung against the right edge. Offline gear already
  // sorts to the front, and it stays that way reading down the first column.
  const mid = Math.ceil(devices.length / 2);
  const columns = [devices.slice(0, mid), devices.slice(mid)];
  return (
    <div className="flex flex-col gap-4">
      <UnifiCard status={status} />
      {status.data && (
        <section className="hud-panel flex flex-col gap-3 p-6">
          <h2 className="text-[15px] font-semibold text-fg/90">Devices</h2>
          {devices.length > 0 ? (
            <div className="grid gap-x-12 sm:grid-cols-2">
              {columns.map((col, ci) => (
                <ul key={ci} className="divide-y divide-fg/10">
                  {col.map((d, i) => (
                    <DeviceRow key={`${d.name}-${i}`} device={d} />
                  ))}
                </ul>
              ))}
            </div>
          ) : (
            <p className="text-sm text-fg/40">No devices reported.</p>
          )}
        </section>
      )}
    </div>
  );
}
