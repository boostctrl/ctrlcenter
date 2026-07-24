// The headline stat each service shows as a complication on the Monitor face
// (#208). One tiny extractor per service — a big `metric` and an optional `sub`
// — derived from the same snapshot the detail page renders in full. The face
// stays glanceable; the depth lives one click away on /admin/monitor/[id].

import type { ServiceId } from "@/lib/services/ids";
import type { ServiceSnapshotMap } from "@/lib/services/registry";
import { formatSpeed } from "./MonitorCard";
import { formatBytes } from "@/components/widgets/SystemStatsWidget";

// A service's glance: a headline `metric`, an optional `sub`, and an optional
// `meter` (0..1) for services whose headline is a natural ratio — the thin gauge
// that gives the face its data-viz texture.
export type Glance = { metric: string; sub?: string; meter?: number };

// "45.2k" — compact, locale-independent (locale formatting hydrates differently
// between server and client).
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export const GLANCES: {
  [K in ServiceId]: (data: ServiceSnapshotMap[K]) => Glance;
} = {
  qbittorrent: (d) => ({
    metric: d.downSpeed > 0 ? `↓ ${formatSpeed(d.downSpeed)}` : plural(d.counts.total, "torrent"),
    sub:
      d.downSpeed > 0
        ? `${d.counts.downloading} downloading`
        : `${d.counts.seeding} seeding · ${d.counts.paused} paused`,
  }),
  sonarr: (d) => ({
    metric: `${d.upcoming.length} upcoming`,
    sub: d.recent.length > 0 ? `${d.recent.length} recent` : undefined,
  }),
  radarr: (d) => ({
    metric: `${d.upcoming.length} upcoming`,
    sub: d.recent.length > 0 ? `${d.recent.length} recent` : undefined,
  }),
  seerr: (d) => ({
    metric: d.pending > 0 ? `${d.pending} pending` : "Clear",
    sub: d.pending > 0 ? "awaiting review" : undefined,
  }),
  tautulli: (d) => ({
    metric: d.streamCount > 0 ? plural(d.streamCount, "stream") : "Idle",
    sub:
      d.streamCount > 0 && d.totalBandwidthKbps
        ? `${formatBytes((d.totalBandwidthKbps * 1000) / 8)}/s`
        : undefined,
  }),
  adguard: (d) => ({
    metric: `${(d.blockedRatio * 100).toFixed(0)}% blocked`,
    sub: `${compact(d.totalQueries)} queries`,
    meter: d.blockedRatio,
  }),
  unifi: (d) => ({
    metric: d.internet.up ? plural(d.clients.total, "client") : "Internet down",
    sub: d.internet.up ? `${d.devices.adopted} devices online` : (d.internet.isp ?? undefined),
  }),
  truenas: (d) => {
    const down = d.apps.filter((a) => !a.running).length;
    const sub =
      d.apps.length > 0
        ? `${plural(d.apps.length, "app")}${down > 0 ? ` · ${down} down` : ""}`
        : d.alerts.length > 0
          ? plural(d.alerts.length, "alert")
          : undefined;
    // The fullest pool's capacity — the number worth watching at a glance.
    const ratios = d.pools.map((p) => p.usedRatio ?? 0);
    const meter = ratios.length > 0 ? Math.max(...ratios) : undefined;
    return { metric: plural(d.pools.length, "pool"), sub, meter };
  },
  portainer: (d) => ({
    metric: `${d.totals.running} running`,
    sub: d.totals.stopped > 0 ? `${d.totals.stopped} stopped` : `${d.totals.total} total`,
    meter: d.totals.total > 0 ? d.totals.running / d.totals.total : undefined,
  }),
};
