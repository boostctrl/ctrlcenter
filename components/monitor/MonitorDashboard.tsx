"use client";

import { useCallback, useEffect, useState } from "react";
import type { MonitorSnapshot } from "@/lib/monitor";
import { SERVICE_LABELS, type ServiceId } from "@/lib/services/ids";
import PageNav from "@/components/PageNav";
import SystemHealthBar from "./SystemHealthBar";
import Complication from "./Complication";
import { serviceState, type ServiceState } from "./MonitorCard";
import { GLANCES } from "./glances";

// The private Monitor cockpit (#207, #208): one cohesive "instrument face" — a
// system-health hero over domain-grouped clusters of clickable complications,
// server-rendered from the shared snapshot cache and kept fresh by polling
// /api/monitor (that same cache, so however many tabs are open the services see
// one fetch per window). Every service always holds its slot; a configured one
// drills into its detail page, an unused one dims and points at Settings — the
// face reads as one designed surface whether one service or all nine are in use.
// The read-only depth (full lists, actions) lives on /admin/monitor/[id].

const REFRESH_MS = 45_000;
const SETTINGS_LINK = "/admin?tab=settings&section=integrations";

// The face's fixed layout: services clustered by domain, in reading order.
const GROUPS: { label: string; ids: ServiceId[] }[] = [
  { label: "Media", ids: ["qbittorrent", "sonarr", "radarr", "seerr", "tautulli"] },
  { label: "Network", ids: ["adguard", "unifi"] },
  { label: "Storage & Containers", ids: ["truenas", "portainer"] },
];

type ComplicationProps = {
  state: ServiceState;
  metric: string;
  sub?: string;
  meter?: number;
  href: string;
};

// One service's complication content from its status. Generic over the id so the
// glance extractor stays correlated with its slice of the snapshot.
function complicationFor<K extends ServiceId>(
  id: K,
  snapshot: MonitorSnapshot
): ComplicationProps {
  const status = snapshot[id];
  const state = serviceState(status);
  if (state === "disabled")
    return { state, metric: "Off", href: SETTINGS_LINK };
  if (state === "unconfigured")
    return { state, metric: "Not set up", href: SETTINGS_LINK };
  if (state === "unreachable")
    return {
      state,
      metric: "Offline",
      sub: status.error ?? undefined,
      href: `/admin/monitor/${id}`,
    };
  // live / stale: data is present, so the glance extractor can read it.
  const glance = GLANCES[id](status.data!);
  return {
    state,
    metric: glance.metric,
    sub: glance.sub,
    meter: glance.meter,
    href: `/admin/monitor/${id}`,
  };
}

export default function MonitorDashboard({
  initial,
  nav,
}: {
  initial: MonitorSnapshot;
  nav: { weather: boolean; status: boolean; calendar: boolean };
}) {
  const [snapshot, setSnapshot] = useState(initial);

  const refresh = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch("/api/monitor");
      if (!res.ok) return;
      setSnapshot((await res.json()) as MonitorSnapshot);
    } catch {
      // Network blip — the interval will try again.
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-6 px-6 py-12 sm:px-10 lg:py-16">
      <div>
        <PageNav current={null} {...nav} />
        <h1 className="mt-3 text-3xl font-bold">Monitor</h1>
        <p className="mt-1 text-sm text-fg/45">
          A read-only view of your connected services. Only signed-in admins can
          see this page — nothing here is ever shown to visitors.
        </p>
      </div>

      {/* One cohesive surface: the health hero, then each domain cluster,
          separated by hairline dividers. */}
      <div className="glass-card divide-y divide-fg/10">
        <div className="p-6">
          <SystemHealthBar snapshot={snapshot} />
        </div>
        {GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-4 p-6">
            <p className="text-[11px] font-medium tracking-wide text-fg/40 uppercase">
              {group.label}
            </p>
            <div className="flex flex-wrap gap-3">
              {group.ids.map((id) => (
                <Complication
                  key={id}
                  label={SERVICE_LABELS[id]}
                  {...complicationFor(id, snapshot)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-fg/35">
        Refreshes automatically every {REFRESH_MS / 1000} seconds while this tab
        is visible.
      </p>
    </main>
  );
}
