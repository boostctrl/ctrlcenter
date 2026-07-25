"use client";

import type { ReactNode } from "react";
import type { MonitorSnapshot } from "@/lib/monitor";
import { SERVICE_IDS, SERVICE_LABELS } from "@/lib/services/ids";
import { serviceState, STATE_DOT, type ServiceState } from "./MonitorCard";

// The cockpit's master status bar (#208): the at-a-glance system-health read
// that sits above the bento so the whole homelab resolves to a single line
// before the eye reaches any one tile. Everything here is derived from the same
// snapshot the tiles render, using the same serviceState/dot vocabulary — so a
// dot in the bar means exactly what a dot on a tile means.

function Chip({
  dot,
  children,
}: {
  // A STATE_DOT class for a leading pip, or omitted for a plain stat chip.
  dot?: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-fg/10 bg-fg/5 px-3 py-1 text-xs text-fg/70">
      {dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {children}
    </span>
  );
}

export default function SystemHealthBar({
  snapshot,
}: {
  snapshot: MonitorSnapshot;
}) {
  const states = SERVICE_IDS.map((id) => serviceState(snapshot[id]));
  const n = (s: ServiceState) => states.filter((x) => x === s).length;
  const live = n("live");
  const stale = n("stale");
  const offline = n("unreachable");
  const disabled = n("disabled");
  const unconfigured = n("unconfigured");
  const connected = live + stale + offline;

  // Cross-service highlights — best effort. Read whenever a snapshot is present
  // (live or last-good/stale); a missing service simply omits its stat.
  const downloading = snapshot.qbittorrent.data?.counts.downloading ?? 0;
  const streams = snapshot.tautulli.data?.streamCount ?? 0;
  const alerts = snapshot.truenas.data?.alerts ?? [];
  const criticalAlerts = alerts.some((a) => a.level === "critical");

  const attention = offline > 0 || criticalAlerts;

  // The one-line verdict, in priority order.
  const overall = attention
    ? { dot: STATE_DOT.unreachable, text: "Attention needed" }
    : stale > 0
      ? { dot: STATE_DOT.stale, text: "Running degraded" }
      : connected > 0
        ? { dot: STATE_DOT.live, text: "All systems normal" }
        : { dot: STATE_DOT.disabled, text: "No integrations connected" };

  // Under an "Attention needed" verdict the subtext names what's wrong — the
  // actual alerts and any offline services — rather than the reassuring
  // connected count that reads oddly next to a red dot.
  const problems: string[] = [
    ...alerts.map((a) => a.message),
    ...SERVICE_IDS.filter((id) => serviceState(snapshot[id]) === "unreachable").map(
      (id) => `${SERVICE_LABELS[id]} offline`
    ),
  ];
  const subtext =
    connected === 0
      ? "Connect a service in Settings to get started."
      : attention && problems.length > 0
        ? problems.slice(0, 2).join(" · ") +
          (problems.length > 2 ? ` · +${problems.length - 2} more` : "")
        : `${connected} of ${SERVICE_IDS.length} services connected`;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${overall.dot}`}
        />
        <div>
          <h2 className="text-lg font-semibold text-fg/90">{overall.text}</h2>
          <p
            className={`text-xs ${
              attention && problems.length > 0
                ? criticalAlerts
                  ? "text-red-300/85"
                  : "text-amber-300/85"
                : "text-fg/45"
            }`}
          >
            {subtext}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {live > 0 && <Chip dot={STATE_DOT.live}>{live} live</Chip>}
        {stale > 0 && <Chip dot={STATE_DOT.stale}>{stale} stale</Chip>}
        {offline > 0 && <Chip dot={STATE_DOT.unreachable}>{offline} offline</Chip>}
        {disabled > 0 && <Chip dot={STATE_DOT.disabled}>{disabled} off</Chip>}
        {unconfigured > 0 && (
          <Chip dot={STATE_DOT.unconfigured}>{unconfigured} to set up</Chip>
        )}

        {/* A thin divider before the activity highlights, when there are any. */}
        {(downloading > 0 || streams > 0 || alerts.length > 0) && (
          <span aria-hidden className="mx-1 h-4 w-px bg-fg/10" />
        )}
        {downloading > 0 && (
          <Chip>
            {downloading} downloading
          </Chip>
        )}
        {streams > 0 && (
          <Chip>
            {streams} stream{streams === 1 ? "" : "s"}
          </Chip>
        )}
        {alerts.length > 0 && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
              criticalAlerts
                ? "border-red-500/30 bg-red-500/10 text-red-300"
                : "border-amber-400/30 bg-amber-400/10 text-amber-200/90"
            }`}
          >
            {alerts.length} alert{alerts.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}
