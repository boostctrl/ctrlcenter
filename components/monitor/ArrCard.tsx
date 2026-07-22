"use client";

import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { ServiceStatus } from "@/lib/monitor";
import type { ArrSnapshot, ArrUpcomingItem, ArrRecentItem } from "@/lib/services/arr";
import MonitorCard from "./MonitorCard";

// The Sonarr/Radarr card on the Monitor page (#191): what's coming to the
// library (the next two weeks of the calendar), what just landed (recent
// grabs/imports), and any health warnings. One component — the two services
// share a snapshot shape.

// The day/relative labels depend on the viewer's clock and time zone, so they
// render only after mount to avoid a server/client hydration mismatch (the
// server has no visitor time zone). Titles render immediately; only the time
// column waits. useSyncExternalStore gives a hydration-safe client flag
// (false on the server, true once mounted) without a set-state-in-effect.
const subscribeNever = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );
}

const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

// "Today" / "Tomorrow" / weekday within a week / "Mon 5" beyond.
function dayLabel(at: number | null): string {
  if (at === null) return "";
  const days = Math.round((startOfDay(at) - startOfDay(Date.now())) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  const d = new Date(at);
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium tracking-wide text-fg/40 uppercase">
      {children}
    </p>
  );
}

function Row({ title, subtitle, meta }: { title: string; subtitle: string; meta: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-sm text-fg/80" title={title}>
        {title}
        {subtitle && <span className="text-fg/45"> · {subtitle}</span>}
      </span>
      {meta && (
        <span className="shrink-0 text-xs tabular-nums text-fg/50">{meta}</span>
      )}
    </li>
  );
}

export default function ArrCard({
  title,
  status,
}: {
  title: "Sonarr" | "Radarr";
  status: ServiceStatus<ArrSnapshot>;
}) {
  const mounted = useMounted();
  const data = status.data;
  return (
    <MonitorCard title={title} status={status}>
      {data && (
        <>
          <div className="flex flex-col gap-2">
            <SectionLabel>Upcoming</SectionLabel>
            {data.upcoming.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {data.upcoming.map((it: ArrUpcomingItem, i) => (
                  <Row
                    key={`${it.title}-${it.subtitle}-${i}`}
                    title={it.title}
                    subtitle={it.subtitle}
                    meta={mounted ? dayLabel(it.at) : ""}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg/40">
                Nothing scheduled in the next two weeks.
              </p>
            )}
          </div>

          {data.recent.length > 0 && (
            <div className="flex flex-col gap-2">
              <SectionLabel>Recent</SectionLabel>
              <ul className="flex flex-col gap-1.5">
                {data.recent.map((it: ArrRecentItem, i) => (
                  <Row
                    key={`${it.title}-${it.subtitle}-${i}`}
                    title={it.title}
                    subtitle={it.subtitle}
                    meta={
                      mounted && it.at !== null
                        ? `${it.event} · ${relTime(it.at)}`
                        : it.event
                    }
                  />
                ))}
              </ul>
            </div>
          )}

          {data.health.length > 0 && (
            <ul className="flex flex-col gap-1 border-t border-fg/10 pt-3">
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
        </>
      )}
    </MonitorCard>
  );
}
