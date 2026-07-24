"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { ServiceStatus } from "@/lib/monitor";
import type {
  QbittorrentSnapshot,
  QbittorrentTorrent,
  TorrentState,
} from "@/lib/services/qbittorrent";
import { Button } from "@/components/admin/ui";
import { useFocusTrap } from "@/components/admin/useFocusTrap";
import MonitorCard, { Meter, formatEta, formatSpeed } from "./MonitorCard";
import { useMonitorAction } from "./actions";

// qBittorrent's card on the Monitor page (#190): overall transfer rates, the
// state tally, and the most interesting torrents (actively moving first) with
// progress. When actions are turned on (#201) each row gains pause/resume and a
// delete that makes the keep-vs-remove-data choice explicit.

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

function TorrentRow({
  torrent,
  actions,
}: {
  torrent: QbittorrentTorrent;
  // Present only when actions are enabled — omitted, the row is read-only.
  actions?: {
    busy: string | null;
    onPauseResume: (t: QbittorrentTorrent) => void;
    onDelete: (t: QbittorrentTorrent) => void;
  };
}) {
  const pct = torrent.progress * 100;
  const transferring = torrent.downSpeed + torrent.upSpeed > 0;
  const detail =
    torrent.state === "downloading" || torrent.state === "stalled"
      ? `${pct.toFixed(0)}%${torrent.eta !== null ? ` · ${formatEta(torrent.eta)}` : ""}`
      : torrent.state === "seeding"
        ? `ratio ${torrent.ratio.toFixed(2)}`
        : `${pct.toFixed(0)}%`;
  const paused = torrent.state === "paused";
  const busy = actions?.busy === torrent.hash;
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
      {actions && (
        <div className="mt-0.5 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => actions.onPauseResume(torrent)}
          >
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={() => actions.onDelete(torrent)}
          >
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}

// The keep-vs-remove-data delete confirmation (#201). The generic useConfirm is
// yes/no; deleting a torrent has two distinct destructive outcomes, so this
// dialog spells both out rather than hiding the data choice behind a checkbox.
function DeleteTorrentModal({
  torrent,
  busy,
  onConfirm,
  onCancel,
}: {
  torrent: QbittorrentTorrent;
  busy: boolean;
  onConfirm: (deleteFiles: boolean) => void;
  onCancel: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  // Portal to the body: the card is a glass-card (backdrop-filter), which makes
  // it the containing block for a `fixed` child — rendered inline the overlay
  // would be trapped inside the card and dim only it, not the viewport.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={onCancel}
    >
      <div
        ref={trapRef}
        role="alertdialog"
        aria-label="Delete torrent"
        className="glass-card w-full max-w-sm space-y-4 p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold">Delete torrent</h3>
        <p className="text-sm break-words text-fg/60">
          Remove <span className="text-fg/80">{torrent.name}</span> from
          qBittorrent. Choose whether to also delete the files it downloaded —
          deleting the data can’t be undone.
        </p>
        <div className="flex flex-col gap-2">
          {/* The less-destructive choice is the accent-filled primary so it
              reads clearly on the modal's glass; deleting the data is the
              danger variant. */}
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => onConfirm(false)}
          >
            Remove torrent, keep files
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => onConfirm(true)}
          >
            Delete torrent and data
          </Button>
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function QbittorrentCard({
  status,
  onActed,
}: {
  status: ServiceStatus<QbittorrentSnapshot>;
  // Refetch the snapshot after a successful action (from MonitorDashboard).
  onActed?: () => void;
}) {
  const data = status.data;
  const { busy, error, run } = useMonitorAction(onActed);
  const [pendingDelete, setPendingDelete] = useState<QbittorrentTorrent | null>(
    null
  );

  const actions = status.actionsAllowed
    ? {
        busy,
        onPauseResume: (t: QbittorrentTorrent) =>
          run(t.hash, {
            service: "qbittorrent" as const,
            action: t.state === "paused" ? "resume" : "pause",
            hash: t.hash,
          }),
        onDelete: (t: QbittorrentTorrent) => setPendingDelete(t),
      }
    : undefined;

  const confirmDelete = async (deleteFiles: boolean) => {
    if (!pendingDelete) return;
    const ok = await run(pendingDelete.hash, {
      service: "qbittorrent",
      action: "delete",
      hash: pendingDelete.hash,
      deleteFiles,
    });
    if (ok) setPendingDelete(null);
  };

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
          {error && <p className="text-xs text-red-400">{error}</p>}
          {data.torrents.length > 0 ? (
            <ul className="divide-y divide-fg/10">
              {/* Names aren't unique (the same release added twice), so pair
                  with the index — the list is a stable server-sorted snapshot,
                  matching ArrCard's key scheme. */}
              {data.torrents.map((t, i) => (
                <TorrentRow key={`${t.hash}-${i}`} torrent={t} actions={actions} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg/40">No torrents.</p>
          )}
        </>
      )}
      {pendingDelete && (
        <DeleteTorrentModal
          torrent={pendingDelete}
          busy={busy === pendingDelete.hash}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </MonitorCard>
  );
}
