"use client";

import type { ServiceStatus } from "@/lib/monitor";
import type { QbittorrentSnapshot } from "@/lib/services/qbittorrent";
import MonitorCard, { formatSpeed } from "./MonitorCard";

// qBittorrent's glance card on the Monitor cockpit (#190, #208): overall
// transfer rates and the state tally. The full torrent list and its pause/
// resume/delete actions live on the detail page (/admin/monitor/qbittorrent)
// now — the whole card links there.

export default function QbittorrentCard({
  status,
}: {
  status: ServiceStatus<QbittorrentSnapshot>;
}) {
  const data = status.data;
  return (
    <MonitorCard
      title="qBittorrent"
      status={status}
      href="/admin/monitor/qbittorrent"
    >
      {data && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-lg font-semibold tabular-nums text-fg/90">
              ↓ {formatSpeed(data.downSpeed)}
            </span>
            <span className="text-lg font-semibold tabular-nums text-fg/90">
              ↑ {formatSpeed(data.upSpeed)}
            </span>
          </div>
          <p className="text-xs text-fg/50">
            {data.counts.total} torrent{data.counts.total === 1 ? "" : "s"} —{" "}
            {data.counts.downloading} downloading · {data.counts.seeding}{" "}
            seeding · {data.counts.paused} paused
            {data.counts.errored > 0 && (
              <span className="text-red-400"> · {data.counts.errored} errored</span>
            )}
          </p>
        </>
      )}
    </MonitorCard>
  );
}
