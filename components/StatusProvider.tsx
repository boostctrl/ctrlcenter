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

// Polls /api/status and exposes the latest results by app id. Mounted only when
// the feature is enabled, so a single fetch backs every dot on the page.
export function StatusProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<Map<string, AppStatus>>(new Map());

  useEffect(() => {
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
  }, []);

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

// A compact health pill linking to the /status page, shown by the dashboard's
// "Applications" heading. Shares the provider's context, so it renders nothing
// until the first poll resolves (avoiding a flash of "all systems operational").
export function StatusSummary({
  apps,
}: {
  apps: { id: string; name: string }[];
}) {
  const statuses = useContext(StatusContext);
  if (!statuses || statuses.size === 0) return null;
  const monitored = apps.filter((a) => statuses.has(a.id));
  const downNames = monitored
    .filter((a) => !statuses.get(a.id)!.up)
    .map((a) => a.name);
  if (monitored.length === 0) return null;
  const allUp = downNames.length === 0;

  return (
    <Link
      href="/status"
      className="group inline-flex items-center gap-2 rounded-full border border-fg/10 bg-fg/[0.03] px-3 py-1 text-xs text-fg/60 transition-colors hover:border-fg/25 hover:text-fg/90"
    >
      <span
        className={`h-2 w-2 rounded-full ${allUp ? "bg-emerald-400" : "bg-red-400"}`}
        aria-hidden
      />
      <span>{statusMessage(downNames, monitored.length)}</span>
      <span className="text-fg/30 transition-transform group-hover:translate-x-0.5">
        →
      </span>
    </Link>
  );
}
