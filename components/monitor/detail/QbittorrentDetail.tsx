"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type {
  QbittorrentDetail as QbittorrentDetailData,
  QbittorrentTorrent,
  TorrentState,
} from "@/lib/services/qbittorrent";
import { Button } from "@/components/admin/ui";
import { useFocusTrap } from "@/components/admin/useFocusTrap";
import { formatBytes } from "@/components/widgets/SystemStatsWidget";
import { Meter, formatEta, formatSpeed } from "../MonitorCard";
import { useMonitorAction } from "../actions";

// qBittorrent's detail page body (#208): the full transfer overview and the
// torrent list with per-row actions — the depth the glance card sheds. The
// action machinery (pause/resume/delete, the keep-vs-remove-data modal) moved
// here from the card unchanged; the card is now a summary that links here.

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

// Torrent ordering the list can be sorted by (#231). "Activity" keeps the
// backend's active-first order; "Status" groups by state in this rank so all the
// downloading torrents sit together, then stalled, seeding, paused, and so on.
type SortKey = "activity" | "status" | "name" | "progress";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "activity", label: "Activity" },
  { key: "status", label: "Status" },
  { key: "name", label: "Name" },
  { key: "progress", label: "Progress" },
];

const STATUS_RANK: Record<TorrentState, number> = {
  downloading: 0,
  stalled: 1,
  queued: 2,
  checking: 3,
  seeding: 4,
  paused: 5,
  error: 6,
};

function sortTorrents(
  list: QbittorrentTorrent[],
  key: SortKey
): QbittorrentTorrent[] {
  if (key === "activity") return list;
  const sorted = [...list];
  if (key === "status")
    sorted.sort(
      (a, b) => STATUS_RANK[a.state] - STATUS_RANK[b.state] || b.progress - a.progress
    );
  else if (key === "name")
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  else sorted.sort((a, b) => b.progress - a.progress);
  return sorted;
}

function TorrentRow({
  torrent,
  actions,
}: {
  torrent: QbittorrentTorrent;
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

// The keep-vs-remove-data delete confirmation (#201): two distinct destructive
// outcomes spelled out rather than hidden behind a checkbox.
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
          <Button variant="primary" disabled={busy} onClick={() => onConfirm(false)}>
            Remove torrent, keep files
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => onConfirm(true)}>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-lg font-semibold tabular-nums text-fg/90">{value}</span>
      <span className="text-[11px] tracking-wide text-fg/40 uppercase">{label}</span>
    </div>
  );
}

export default function QbittorrentDetail({
  data,
  error,
  actionsAllowed,
  onActed,
}: {
  data: QbittorrentDetailData | null;
  error: string | null;
  actionsAllowed: boolean;
  onActed?: () => void;
}) {
  const { busy, error: actionError, run } = useMonitorAction(onActed);
  const [pendingDelete, setPendingDelete] = useState<QbittorrentTorrent | null>(
    null
  );
  const [sortBy, setSortBy] = useState<SortKey>("activity");

  if (!data) {
    return (
      <section className="hud-panel flex flex-col items-center gap-2 p-8 text-center">
        <p className="text-sm text-fg/55">Can’t reach qBittorrent</p>
        {error && <p className="text-xs text-fg/35">{error}</p>}
      </section>
    );
  }

  // Actions render only when the integration's opt-in is on (#201), exactly as
  // the card gated them before they moved here.
  const actions = actionsAllowed
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

  const s = data.session;
  return (
    <div className="flex flex-col gap-4">
      <section className="hud-panel flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1">
          <span className="text-2xl font-semibold tabular-nums text-fg/90">
            ↓ {formatSpeed(data.downSpeed)}
          </span>
          <span className="text-2xl font-semibold tabular-nums text-fg/90">
            ↑ {formatSpeed(data.upSpeed)}
          </span>
          {s.connection && (
            <span className="text-xs text-fg/50">{s.connection}</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-fg/10 pt-4 sm:grid-cols-4">
          <Stat label="Session ↓" value={formatBytes(s.sessionDown)} />
          <Stat label="Session ↑" value={formatBytes(s.sessionUp)} />
          <Stat label="All-time ↓" value={formatBytes(s.allTimeDown)} />
          <Stat label="All-time ↑" value={formatBytes(s.allTimeUp)} />
          {s.ratio !== null && <Stat label="Ratio" value={s.ratio.toFixed(2)} />}
          {s.freeSpace !== null && (
            <Stat label="Free space" value={formatBytes(s.freeSpace)} />
          )}
        </div>
        <p className="text-xs text-fg/50">
          {data.counts.total} torrent{data.counts.total === 1 ? "" : "s"} —{" "}
          {data.counts.downloading} downloading · {data.counts.seeding} seeding ·{" "}
          {data.counts.paused} paused
          {data.counts.errored > 0 && (
            <span className="text-red-400"> · {data.counts.errored} errored</span>
          )}
        </p>
        {actionError && <p className="text-xs text-red-400">{actionError}</p>}
      </section>

      <section className="hud-panel flex flex-col gap-3 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-fg/90">Torrents</h2>
          {data.torrents.length > 1 && (
            <div className="flex items-center gap-1 text-xs">
              <span className="mr-1 text-fg/40">Sort</span>
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setSortBy(opt.key)}
                  className={`rounded-full px-2.5 py-1 transition-colors ${
                    sortBy === opt.key
                      ? "bg-fg/10 text-fg/90"
                      : "text-fg/50 hover:text-fg/80"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {data.torrents.length > 0 ? (
          <ul className="divide-y divide-fg/10">
            {sortTorrents(data.torrents, sortBy).map((t, i) => (
              <TorrentRow key={`${t.hash}-${i}`} torrent={t} actions={actions} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg/40">No torrents.</p>
        )}
      </section>

      {pendingDelete && (
        <DeleteTorrentModal
          torrent={pendingDelete}
          busy={busy === pendingDelete.hash}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
