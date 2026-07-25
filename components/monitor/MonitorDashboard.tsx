"use client";

import { useCallback, useEffect, useState } from "react";
import type { MonitorSnapshot } from "@/lib/monitor";
import { SERVICE_LABELS, type ServiceId } from "@/lib/services/ids";
import PageNav from "@/components/PageNav";
import SystemHealthBar from "./SystemHealthBar";
import Complication from "./Complication";
import { serviceState, sinceLabel, type ServiceState } from "./MonitorCard";
import { GLANCES, type GlanceVisual } from "./glances";

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

// The face's fixed layout: services clustered by domain. Network and storage —
// the infrastructure — lead; media follows, its five services laid out 3 + 2
// (Seerr/Radarr/Sonarr, then Tautulli/qBittorrent) so the section reads as two
// tidy rows rather than a lopsided four-and-one.
const GROUPS: { label: string; ids: ServiceId[] }[] = [
  { label: "Network", ids: ["adguard", "unifi"] },
  { label: "Storage & Containers", ids: ["truenas", "portainer"] },
  { label: "Media", ids: ["seerr", "radarr", "sonarr", "tautulli", "qbittorrent"] },
];

type ComplicationProps = {
  state: ServiceState;
  href: string;
  center: string;
  caption: string;
  ring?: number;
  alert?: boolean;
  lines: string[];
  visual?: GlanceVisual;
};

// One service's complication content from its status. Generic over the id so the
// glance extractor stays correlated with its slice of the snapshot. The three
// non-data states get standardized gauge dials; live/stale defer to the
// per-service extractor. `now` (null until mounted) drives relative dates.
function complicationFor<K extends ServiceId>(
  id: K,
  snapshot: MonitorSnapshot,
  now: number | null
): ComplicationProps {
  const status = snapshot[id];
  const state = serviceState(status);
  if (state === "disabled")
    return { state, href: SETTINGS_LINK, center: "Off", caption: "", lines: ["Turned off"] };
  if (state === "unconfigured")
    return {
      state,
      href: SETTINGS_LINK,
      center: "+",
      caption: "set up",
      lines: ["Not connected"],
    };
  if (state === "unreachable")
    return {
      state,
      href: `/admin/monitor/${id}`,
      center: "!",
      caption: "offline",
      alert: true,
      lines: [status.error ?? "Can’t reach"],
    };
  // live / stale: data is present, so the glance extractor can read it.
  return {
    state,
    href: `/admin/monitor/${id}`,
    ...GLANCES[id](status.data!, now),
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
  // Client-time for relative dates ("in 3d"). Null on the server render and the
  // first client paint so those strings can't mismatch on hydration; set on
  // mount and kept current as data refreshes.
  const [now, setNow] = useState<number | null>(null);
  // When the shown snapshot last came back, for the header's freshness read —
  // also null until mount so the "updated Xs ago" label can't mismatch either.
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch("/api/monitor");
      if (!res.ok) return;
      setSnapshot((await res.json()) as MonitorSnapshot);
      const at = Date.now();
      setNow(at);
      setUpdatedAt(at);
    } catch {
      // Network blip — the interval will try again.
    }
  }, []);

  useEffect(() => {
    // After paint (not synchronously in the effect) so relative dates appear
    // without risking a hydration mismatch on the first render.
    const raf = requestAnimationFrame(() => {
      const at = Date.now();
      setNow(at);
      setUpdatedAt(at);
    });
    const timer = setInterval(refresh, REFRESH_MS);
    // A lighter clock so the header freshness label re-ticks between polls
    // rather than sitting frozen for a whole 45s refresh window.
    const clock = setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [refresh]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-6 px-6 py-12 sm:px-10 lg:py-16">
      <div>
        <PageNav current={null} {...nav} />
        <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="text-3xl font-bold">Monitor</h1>
            <p className="mt-1 text-sm text-fg/45">
              A read-only view of your connected services. Only signed-in admins
              can see this page — nothing here is ever shown to visitors.
            </p>
          </div>
          {/* A freshness read that mirrors the detail pages' status pill, so the
              whole Monitor reads as one family. No status dot here — the health
              hero below is the cockpit's verdict. */}
          {updatedAt !== null && now !== null && (
            <span className="inline-flex shrink-0 items-center rounded-full border border-fg/10 bg-fg/5 px-3.5 py-1.5 text-xs whitespace-nowrap text-fg/50">
              Updated {sinceLabel(now - updatedAt)}
            </span>
          )}
        </div>
      </div>

      {/* The health hero, then each domain cluster — every surface is a
          glass-card, so the whole cockpit takes on the active design: pick a
          glowing design like Cyber and the tiles read as a lit instrument
          panel, pick Flat and they're clean cards. */}
      <div className="flex flex-col gap-6">
        <div className="glass-card p-6">
          <SystemHealthBar snapshot={snapshot} />
        </div>
        {GROUPS.map((group) => (
          <section key={group.label} className="flex flex-col gap-4">
            <p className="text-[11px] font-medium tracking-wide text-fg/40 uppercase">
              {group.label}
            </p>
            <div className="flex flex-wrap gap-3">
              {group.ids.map((id) => (
                <Complication
                  key={id}
                  label={SERVICE_LABELS[id]}
                  {...complicationFor(id, snapshot, now)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="text-[11px] text-fg/35">
        Refreshes automatically every {REFRESH_MS / 1000} seconds while this tab
        is visible.
      </p>
    </main>
  );
}
