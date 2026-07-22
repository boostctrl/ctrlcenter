"use client";

import type { ServiceStatus } from "@/lib/monitor";
import type { TautulliSnapshot, TautulliSession } from "@/lib/services/tautulli";
import MonitorCard, { Meter } from "./MonitorCard";

// Tautulli's card on the Monitor page (#195): who's watching Plex right now —
// stream count, total bandwidth, and each session's progress and whether it's
// a direct play or a transcode (the "is the server working hard" signal).

// Tautulli reports bandwidth in kbps; show Mbps once it's a real stream.
function formatBandwidth(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

function SessionRow({ session }: { session: TautulliSession }) {
  return (
    <li className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-fg/80" title={session.title}>
          {session.title}
          <span className="text-fg/45"> · {session.user}</span>
        </span>
        <span className="flex shrink-0 items-baseline gap-2 text-xs tabular-nums">
          {session.state !== "playing" && (
            <span className="text-amber-400/80">{session.state}</span>
          )}
          <span
            className={
              session.playback === "transcode"
                ? "text-amber-400/80"
                : "text-emerald-400/90"
            }
          >
            {session.playback === "transcode" ? "transcode" : "direct"}
          </span>
          {session.quality && <span className="text-fg/50">{session.quality}</span>}
          <span className="text-fg/60">{session.progress.toFixed(0)}%</span>
        </span>
      </div>
      <Meter percent={session.progress} />
    </li>
  );
}

export default function TautulliCard({
  status,
}: {
  status: ServiceStatus<TautulliSnapshot>;
}) {
  const data = status.data;
  return (
    <MonitorCard title="Tautulli" status={status}>
      {data && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-lg font-semibold tabular-nums text-fg/90">
              {data.streamCount}
              <span className="ml-1.5 text-xs font-normal text-fg/50">
                stream{data.streamCount === 1 ? "" : "s"}
              </span>
            </span>
            {data.totalBandwidthKbps !== null && data.totalBandwidthKbps > 0 && (
              <span className="text-lg font-semibold tabular-nums text-fg/90">
                {formatBandwidth(data.totalBandwidthKbps)}
              </span>
            )}
          </div>
          {data.transcodeCount > 0 && (
            <p className="text-xs text-amber-400/80">
              {data.transcodeCount} transcoding
            </p>
          )}
          {data.sessions.length > 0 ? (
            <ul className="divide-y divide-fg/10">
              {/* Titles aren't unique (two viewers on one episode), so pair
                  with the index — the list is a stable snapshot. */}
              {data.sessions.map((s, i) => (
                <SessionRow key={`${s.title}-${s.user}-${i}`} session={s} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg/40">Nothing is playing.</p>
          )}
        </>
      )}
    </MonitorCard>
  );
}
