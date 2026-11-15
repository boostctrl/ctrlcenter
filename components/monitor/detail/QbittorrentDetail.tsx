"use client";

import { useRef, useState } from "react";
import type {
  QbittorrentDetail as QbittorrentDetailData,
  QbittorrentTorrent,
  TorrentState,
} from "@/lib/services/qbittorrent";
import { Button } from "@/components/admin/ui";
import { formatBytes } from "@/components/widgets/SystemStatsWidget";
import { formatEta, formatSpeed } from "@/lib/format";
import { useMonitorAction } from "../actions";
import {
  Dialog,
  EmptyRow,
  GlyphBubble,
  List,
  MoreButton,
  Pill,
  Row,
  Section,
  Stat,
  StatGrid,
  UsageBar,
  type GlyphName,
  type Tone,
} from "../kit";

// qBittorrent's page (#513), on the page kit (#508): transfer speeds and
// totals, then every torrent with its progress, sortable, with pause,
// resume and delete when actions are on (#201).

const STATE: Record<TorrentState, { label: string; tone: Tone; glyph: GlyphName }> = {
  downloading: { label: "Downloading", tone: "info", glyph: "download" },
  seeding: { label: "Seeding", tone: "up", glyph: "upload" },
  paused: { label: "Paused", tone: "muted", glyph: "pause" },
  queued: { label: "Queued", tone: "muted", glyph: "clock" },
  checking: { label: "Checking", tone: "warn", glyph: "pulse" },
  stalled: { label: "Stalled", tone: "warn", glyph: "alert" },
  error: { label: "Error", tone: "down", glyph: "error" },
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

function sortTorrents(list: QbittorrentTorrent[], key: SortKey): QbittorrentTorrent[] {
  if (key === "activity") return list;
  const sorted = [...list];
  if (key === "status") sorted.sort((a, b) => STATUS_RANK[a.state] - STATUS_RANK[b.state] || b.progress - a.progress);
  else if (key === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
  else sorted.sort((a, b) => b.progress - a.progress);
  return sorted;
}

// How many torrents show before "Show all".
const SHOWN = 25;

// The line under a torrent's name: its size, and what it's doing.
function torrentLine(t: QbittorrentTorrent): string {
  const parts = [formatBytes(t.size)];
  if (t.downSpeed > 0) parts.push(`↓ ${formatSpeed(t.downSpeed)}`);
  if (t.upSpeed > 0) parts.push(`↑ ${formatSpeed(t.upSpeed)}`);
  if ((t.state === "downloading" || t.state === "stalled") && t.eta !== null) parts.push(`${formatEta(t.eta)} left`);
  if (t.state === "seeding") parts.push(`ratio ${t.ratio.toFixed(2)}`);
  return parts.join(" · ");
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
  const state = STATE[torrent.state];
  const busy = actions?.busy === torrent.hash;
  return (
    <Row
      leading={<GlyphBubble name={state.glyph} tone={state.tone} />}
      primary={torrent.name}
      title={torrent.name}
      secondary={torrentLine(torrent)}
      trailing={
        <>
          <Pill tone={state.tone}>{state.label}</Pill>
          <span>{Math.floor(torrent.progress * 100)}%</span>
        </>
      }
      below={
        <div className="flex items-center gap-3">
          <UsageBar
            ratio={torrent.progress}
            tone={torrent.state === "error" ? "down" : torrent.state === "paused" ? "muted" : undefined}
            className="h-1 flex-1"
          />
          {actions && (
            <span className="flex shrink-0 gap-2">
              <Button
                aria-label={`${torrent.state === "paused" ? "Resume" : "Pause"} ${torrent.name}`}
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => actions.onPauseResume(torrent)}
              >
                {torrent.state === "paused" ? "Resume" : "Pause"}
              </Button>
              <Button
                aria-label={`Delete ${torrent.name}`}
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => actions.onDelete(torrent)}
              >
                Delete
              </Button>
            </span>
          )}
        </div>
      }
    />
  );
}

// The keep-vs-remove-data delete confirmation (#201): two distinct destructive
// outcomes spelled out rather than hidden behind a checkbox. Focus starts on
// Cancel, so a reflexive Enter backs out (#269).
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
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title="Delete torrent"
      alert
      onClose={() => {
        if (!busy) onCancel();
      }}
      initialFocus={cancelRef}
      description={
        <>
          Remove <span className="text-ink-80">{torrent.name}</span> from qBittorrent. Choose whether to also delete the
          files it downloaded — deleting the data can’t be undone.
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <Button variant="primary" disabled={busy} onClick={() => onConfirm(false)}>
          Remove torrent, keep files
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => onConfirm(true)}>
          Delete torrent and data
        </Button>
      </div>
      <div className="flex justify-end">
        <Button ref={cancelRef} variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

export default function QbittorrentDetail({
  data,
  actionsAllowed,
  onActed,
}: {
  data: QbittorrentDetailData;
  actionsAllowed: boolean;
  onActed?: () => void;
}) {
  const { busy, error: actionError, run } = useMonitorAction(onActed);
  const [pendingDelete, setPendingDelete] = useState<QbittorrentTorrent | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("activity");
  const [all, setAll] = useState(false);

  // Actions render only when the integration's opt-in is on (#201).
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
  const c = data.counts;
  const sorted = sortTorrents(data.torrents, sortBy);
  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <Stat
          label="Download"
          value={formatSpeed(data.downSpeed)}
          hint={`${formatBytes(s.sessionDown)} this session · ${formatBytes(s.allTimeDown)} in all`}
        />
        <Stat
          label="Upload"
          value={formatSpeed(data.upSpeed)}
          hint={`${formatBytes(s.sessionUp)} this session · ${formatBytes(s.allTimeUp)} in all`}
        />
        <Stat
          label="Ratio"
          value={s.ratio !== null ? s.ratio.toFixed(2) : "—"}
          hint={s.freeSpace !== null ? `${formatBytes(s.freeSpace)} free on disk` : undefined}
        />
        <Stat
          label="Torrents"
          value={c.total}
          tone={c.errored > 0 ? "down" : undefined}
          hint={[`${c.downloading} downloading`, `${c.seeding} seeding`, c.errored ? `${c.errored} errored` : null]
            .filter(Boolean)
            .join(" · ")}
        />
      </StatGrid>

      <Section
        title="Torrents"
        count={data.torrents.length}
        description={actionError ? <span className="text-status-down">{actionError}</span> : undefined}
        actions={
          data.torrents.length > 1 && (
            <div role="group" aria-label="Sort torrents" className="flex items-center gap-1 text-xs">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={sortBy === opt.key}
                  onClick={() => setSortBy(opt.key)}
                  className={`rounded-full px-2.5 py-1 transition-colors ${
                    sortBy === opt.key ? "bg-fg/10 text-ink-90" : "text-ink-55 hover:text-ink-85"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )
        }
        flush
      >
        {sorted.length > 0 ? (
          <List>
            {(all ? sorted : sorted.slice(0, SHOWN)).map((t, i) => (
              <TorrentRow key={`${t.hash}-${i}`} torrent={t} actions={actions} />
            ))}
          </List>
        ) : (
          <EmptyRow>No torrents.</EmptyRow>
        )}
        {sorted.length > SHOWN && <MoreButton expanded={all} total={sorted.length} onToggle={() => setAll((v) => !v)} />}
      </Section>

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
