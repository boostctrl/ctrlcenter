"use client";

import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { statusMessage, type AppStatus, type StatusResponse } from "@/lib/status";

const StatusContext = createContext<Map<string, AppStatus> | null>(null);

const POLL_MS = 60_000;

// Polls /api/status and exposes the latest results by app id. Wraps the whole
// page (header chip + per-app dots) so a single fetch backs every indicator;
// pass enabled={false} to skip polling when status checks are off or there are
// no apps to monitor.
export function StatusProvider({
  enabled = true,
  children,
}: {
  enabled?: boolean;
  children: ReactNode;
}) {
  const [statuses, setStatuses] = useState<Map<string, AppStatus>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) return;
        const data: StatusResponse = await res.json();
        if (active) setStatuses(new Map(data.results.map((d) => [d.id, d])));
      } catch {
        // Network hiccups just leave the previous statuses in place.
      }
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [enabled]);

  return (
    <StatusContext.Provider value={statuses}>{children}</StatusContext.Provider>
  );
}

// Renders a small online/offline dot for an app. Renders nothing when status
// checks are disabled (no provider) or before the first poll resolves.
export function StatusDot({ id }: { id: string }) {
  const statuses = useContext(StatusContext);
  const status = statuses?.get(id);
  if (!status) return null;

  const title = status.up
    ? `Online${status.status ? ` · HTTP ${status.status}` : ""} · ${status.ms}ms`
    : "Offline";

  return (
    <span
      className="absolute top-3 right-3 flex h-2.5 w-2.5"
      title={title}
      role="img"
      aria-label={status.up ? "Online" : "Offline"}
    >
      {status.up && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
      )}
      <span
        className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
          status.up ? "bg-emerald-400" : "bg-red-400"
        }`}
      />
    </span>
  );
}

// A health row linking to the /status page, rendered beneath the time/weather
// row inside the same header card (a hairline border separates them). Shares the
// provider's context, so it renders nothing — and shows no divider — until the
// first poll resolves (avoiding a flash of "all systems operational").
export function StatusSummary({
  apps,
}: {
  apps: { id: string; name: string }[];
}) {
  const statuses = useContext(StatusContext);
  if (!statuses || statuses.size === 0) return null;
  const monitored = apps.filter((a) => statuses.has(a.id));
  if (monitored.length === 0) return null;
  const downNames = monitored
    .filter((a) => !statuses.get(a.id)!.up)
    .map((a) => a.name);
  const allUp = downNames.length === 0;
  const message = statusMessage(downNames, monitored.length);

  return (
    <Link
      href="/status"
      title={message}
      aria-label={`Service status: ${message}`}
      className="flex items-center gap-2 border-t border-fg/10 px-6 py-3 text-sm text-fg/70 transition-colors hover:bg-fg/[0.03] hover:text-fg"
    >
      <span className="relative flex h-2.5 w-2.5" aria-hidden>
        {allUp && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
        )}
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${allUp ? "bg-emerald-400" : "bg-red-400"}`}
        />
      </span>
      <span className="font-medium">{message}</span>
    </Link>
  );
}
