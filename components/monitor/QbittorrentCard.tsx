"use client";

import type { ServiceStatus } from "@/lib/monitor";
import type {
  QbittorrentSnapshot,
  QbittorrentTorrent,
  TorrentState,
} from "@/lib/services/qbittorrent";
import MonitorCard, { Meter, formatEta, formatSpeed } from "./MonitorCard";

// qBittorrent's card on the Monitor page (#190): overall transfer rates, the
// state tally, and the most interesting torrents (actively moving first) with
// progress. Read-only — the torrent manager itself is one click away via the
// app grid; this card answers "is anything moving, and how fast".

const STATE_LABELS: Record<TorrentState, string> = {
  downloading: "downloading",
  seeding: "seeding",
  paused: "paused",
  queued: "queued",
  checking: "checking",
  stalled: "stalled",
  error: "error",
};

const STATE_TONES: Record<TorrentState, string> = {
  downloading: "text-emerald-400/90",
  seeding: "text-sky-400/80",
  paused: "text-fg/40",
  queued: "text-fg/40",
  checking: "text-amber-400/80",
  stalled: "text-amber-400/80",
  error: "text-red-400",
};

function TorrentRow({ torrent }: { torrent: QbittorrentTorrent }) {
  const pct = torrent.progress * 100;
  const transferring = torrent.downSpeed + torrent.upSpeed > 0;
  const detail =
    torrent.state === "downloading" || torrent.state === "stalled"
      ? `${pct.toFixed(0)}%${torrent.eta !== null ? ` · ${formatEta(torrent.eta)}` : ""}`
      : torrent.state === "seeding"
        ? `ratio ${torrent.ratio.toFixed(2)}`
        : `${pct.toFixed(0)}%`;
  return (
    <li className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-fg/80" title={torrent.name}>
          {torrent.name}
        </span>
        <span className="flex shrink-0 items-baseline gap-2 text-xs tabular-nums">
          {transferring && (
            <span className="text-fg/50">
              {torrent.downSpeed > 0
                ? `↓ ${formatSpeed(torrent.downSpeed)}`
                : `↑ ${formatSpeed(torrent.upSpeed)}`}
            </span>
          )}
          <span className={STATE_TONES[torrent.state]}>
            {STATE_LABELS[torrent.state]}
          </span>
          <span className="text-fg/60">{detail}</span>
        </span>
      </div>
      <Meter percent={pct} />
    </li>
  );
}

export default function QbittorrentCard({
  status,
}: {
  status: ServiceStatus<QbittorrentSnapshot>;
}) {
  const data = status.data;
  return (
    <MonitorCard title="qBittorrent" status={status}>
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
          {data.torrents.length > 0 ? (
            <ul className="divide-y divide-fg/10">
              {data.torrents.map((t) => (
                <TorrentRow key={t.name} torrent={t} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg/40">No torrents.</p>
          )}
        </>
      )}
    </MonitorCard>
  );
}
