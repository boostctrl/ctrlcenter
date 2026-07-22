"use client";

import type { ServiceStatus } from "@/lib/monitor";
import type { ArrSnapshot } from "@/lib/services/arr";
import MonitorCard, { Meter } from "./MonitorCard";

// The Sonarr/Radarr card on the Monitor page (#191): health warnings first
// (they're why you'd look), then the download queue with progress, then the
// missing count. One component — the two services share a snapshot shape.

export default function ArrCard({
  title,
  noun,
  status,
}: {
  title: "Sonarr" | "Radarr";
  // What the missing count counts.
  noun: "episodes" | "movies";
  status: ServiceStatus<ArrSnapshot>;
}) {
  const data = status.data;
  return (
    <MonitorCard title={title} status={status}>
      {data && (
        <>
          {data.health.length > 0 && (
            <ul className="flex flex-col gap-1">
              {data.health.map((h, i) => (
                <li
                  key={`${h.message}-${i}`}
                  className={`text-xs ${
                    h.type === "error" ? "text-red-400" : "text-amber-400/90"
                  }`}
                >
                  {h.message}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-fg/50">
            {data.queueCount} in queue ·{" "}
            <span className={data.missingCount > 0 ? "text-fg/60" : ""}>
              {data.missingCount} missing {noun}
            </span>
          </p>
          {data.queue.length > 0 ? (
            <ul className="divide-y divide-fg/10">
              {data.queue.map((item, i) => (
                <li
                  key={`${item.title}-${i}`}
                  className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className="min-w-0 truncate text-sm text-fg/80"
                      title={item.title}
                    >
                      {item.title}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-fg/60">
                      {item.status}
                      {item.timeLeft ? ` · ${item.timeLeft}` : ""}
                    </span>
                  </div>
                  {item.progress !== null && (
                    <Meter percent={item.progress * 100} />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg/40">Queue is empty.</p>
          )}
        </>
      )}
    </MonitorCard>
  );
}
