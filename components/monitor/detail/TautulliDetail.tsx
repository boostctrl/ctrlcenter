"use client";

import { useSyncExternalStore } from "react";
import type { ServiceStatus } from "@/lib/monitor";
import type { TautulliDetail as TautulliDetailData } from "@/lib/services/tautulli";
import TautulliCard from "../TautulliCard";

// Tautulli's detail page body (#223): the card's live "who's watching now"
// summary plus a page of recent watch history — who watched what and when, and
// whether it was a transcode. The history is the depth the glance sheds.

// A hydration-safe mounted flag (false on the server, true once mounted) so the
// relative "2h ago" times — which depend on the viewer's clock — render only on
// the client and never mismatch the server HTML.
const subscribeNever = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );
}

function relTime(at: number | null): string {
  if (at === null) return "";
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function TautulliDetail({
  status,
}: {
  status: ServiceStatus<TautulliDetailData>;
}) {
  const mounted = useMounted();
  const history = status.data?.history ?? [];
  return (
    // Now-playing and history side by side on wide screens, so the page fills
    // the width instead of stacking two half-empty bands.
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <TautulliCard status={status} />
      {status.data && (
        <section className="glass-card flex flex-col gap-3 p-6">
          <h2 className="text-[15px] font-semibold text-fg/90">Recently watched</h2>
          {history.length > 0 ? (
            <ul className="divide-y divide-fg/10">
              {history.map((h, i) => (
                <li
                  key={`${h.title}-${h.at ?? i}-${i}`}
                  className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0 truncate text-sm text-fg/80" title={h.title}>
                    {h.title}
                    <span className="text-fg/45"> · {h.user}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2 text-xs tabular-nums text-fg/50">
                    {h.playback === "transcode" && (
                      <span className="text-amber-400/80">transcode</span>
                    )}
                    {mounted && <span>{relTime(h.at)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg/40">No recent history.</p>
          )}
        </section>
      )}
    </div>
  );
}
