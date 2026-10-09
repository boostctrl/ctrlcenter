"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { statusMessage, type AppStatus, type StatusResponse } from "@/lib/status";
import { usePolling } from "./usePolling";

const StatusContext = createContext<Map<string, AppStatus> | null>(null);

const POLL_MS = 60_000;

// Polls /api/status and exposes the latest results by app id. Wraps the whole
// page (header status row + per-app dots) so a single fetch backs every
// indicator; pass enabled={false} to skip polling when status checks are off or
// there are no apps to monitor.
export function StatusProvider({
  enabled = true,
  children,
}: {
  enabled?: boolean;
  children: ReactNode;
}) {
  const [statuses, setStatuses] = useState<Map<string, AppStatus>>(new Map());

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetch("/api/status", { cache: "no-store", signal });
      if (!res.ok) return;
      const data: StatusResponse = await res.json();
      if (!signal.aborted) setStatuses(new Map(data.results.map((d) => [d.id, d])));
    } catch {
      // Network hiccups just leave the previous statuses in place.
    }
  }, []);
  usePolling(load, POLL_MS, { enabled });

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
    ? status.warning
      ? `Online · ${status.warning}`
      : `Online${status.status ? ` · HTTP ${status.status}` : ""} · ${status.ms}ms`
    : `Offline${status.status ? ` · HTTP ${status.status}` : ""}`;
  // Up with a warning (a certificate near expiry, #294) shows amber.
  const warn = status.up && Boolean(status.warning);

  return (
    <span
      className="absolute top-3 right-3 flex h-2.5 w-2.5"
      title={title}
      role="img"
      aria-label={status.up ? (warn ? `Online, ${status.warning}` : "Online") : "Offline"}
    >
      {status.up && !warn && (
        <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-emerald-400/60" />
      )}
      {/* Up is a solid dot, down a hollow ring, so the state reads by shape
          as well as color for color-blind visitors (#273). */}
      <span
        className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
          warn ? "bg-amber-400" : status.up ? "bg-emerald-400" : "border-2 border-red-400"
        }`}
      />
    </span>
  );
}

// A health row linking to the /status page. As a "row" it renders beneath the
// time/weather row inside the header card (a hairline border separates them);
// as a "card" it stands alone on its own glass surface (the status widget).
// Shares the provider's context, so it renders nothing — and shows no divider —
// until the first poll resolves (avoiding a flash of "all systems operational").
const SUMMARY_VARIANTS: Record<"row" | "card", string> = {
  row: "group flex items-center gap-2 border-t border-fg/10 px-6 py-3 text-sm text-ink-70 transition-colors hover:bg-fg/[0.03] hover:text-fg",
  card: "group glass-card flex w-full items-center gap-2 px-6 py-4 text-sm text-ink-70 transition-colors hover:text-fg sm:w-auto",
};

export function StatusSummary({
  apps,
  variant = "row",
}: {
  apps: { id: string; name: string }[];
  variant?: "row" | "card";
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
      // No aria-label: the visible text ("All systems operational · Uptime &
      // outages") is the accessible name, so speech users can say what they
      // see (WCAG 2.5.3).
      className={SUMMARY_VARIANTS[variant]}
    >
      <span className="relative flex h-2.5 w-2.5" aria-hidden>
        {allUp && (
          <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-emerald-400/60" />
        )}
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${allUp ? "bg-emerald-400" : "bg-red-400"}`}
        />
      </span>
      <span className="font-medium">{message}</span>
      {/* The glance is the home page's door to /status (#177): name the
          destination at rest so the row reads as a link, not just a status
          readout. Hidden on the narrowest widths — the combo card is the
          app's most fragile responsive surface (#78/#105/#154), and there
          the whole row already serves as the tap target. */}
      <span className="ml-auto hidden text-xs text-ink-40 transition-colors group-hover:text-ink-75 group-focus-visible:text-ink-75 sm:inline">
        Uptime & outages
      </span>
    </Link>
  );
}
