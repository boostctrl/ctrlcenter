"use client";

import { useCallback, useEffect, useState } from "react";
import type { MonitorSnapshot } from "@/lib/monitor";
import { SERVICE_LABELS, type ServiceId } from "@/lib/services/ids";
import PageNav from "@/components/PageNav";
import SystemHealthBar from "./SystemHealthBar";
import Complication from "./Complication";
import { serviceState, sinceLabel, type ServiceState } from "./MonitorCard";
import { GLANCES, type GlanceVisual } from "./glances";
import { settingsCardId } from "@/lib/nav";
import { usePolling } from "@/components/usePolling";
import { useNow } from "@/components/useNow";

// The private Monitor cockpit (#207, #208): one cohesive "instrument face" — a
// system-health hero over domain-grouped clusters of clickable complications,
// server-rendered from the shared snapshot cache and kept fresh by polling
// /api/monitor (that same cache, so however many tabs are open the services see
// one fetch per window). Every service always holds its slot; a configured one
// drills into its detail page, an unused one dims and points at Settings — the
// face reads as one designed surface whether one service or all nine are in use.
// The read-only depth (full lists, actions) lives on /admin/monitor/[id].

const REFRESH_MS = 45_000;
// Each off / not-set-up tile opens its own service's settings card (#277).
function settingsLink(id: ServiceId): string {
  return `/admin?tab=settings&section=integrations#${settingsCardId(SERVICE_LABELS[id])}`;
}

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
    return { state, href: settingsLink(id), center: "Off", caption: "", lines: ["Turned off"] };
  if (state === "unconfigured")
    return {
      state,
      href: settingsLink(id),
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
  // When the shown snapshot last came back, for the header's freshness read —
  // null on the server render and the first client paint so neither it nor
  // the relative dates ("in 3d") can mismatch on hydration; set after paint
  // and on every good refresh.
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // A lighter clock so the freshness label re-ticks between polls rather than
  // sitting frozen for a whole 45s refresh window. Client-time for relative
  // dates; null until mount, and never behind the last refresh.
  const clock = useNow(10_000);
  const now = updatedAt === null ? null : Math.max(clock, updatedAt);

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetch("/api/monitor", { signal });
      if (!res.ok) return;
      const next = (await res.json()) as MonitorSnapshot;
      if (signal.aborted) return;
      setSnapshot(next);
      setUpdatedAt(Date.now());
    } catch {
      // Network blip — the next poll will try again.
    }
  }, []);
  // Seeded with server data, so the first poll waits a full interval.
  usePolling(load, REFRESH_MS, { immediate: false });

  useEffect(() => {
    // After paint (not synchronously in the effect) so relative dates appear
    // without risking a hydration mismatch on the first render.
    const raf = requestAnimationFrame(() => setUpdatedAt(Date.now()));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <main id="main-content" className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-6 px-6 pt-12 pb-24 sm:px-10 lg:pt-16">
      <div>
        <PageNav current={null} {...nav} />
        <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="text-3xl font-bold">Monitor</h1>
            <p className="mt-1 text-sm text-ink-45">
              Live status of your connected services, plus any actions you&apos;ve
              switched on for them. Only signed-in admins can see this page —
              nothing here is ever shown to visitors.
            </p>
          </div>
          {/* A freshness read that mirrors the detail pages' status pill, so the
              whole Monitor reads as one family. No status dot here — the health
              hero below is the cockpit's verdict. */}
          {updatedAt !== null && now !== null && (
            <span className="inline-flex shrink-0 items-center rounded-full border border-fg/10 bg-fg/5 px-3.5 py-1.5 text-xs whitespace-nowrap text-ink-50">
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
            <p className="text-[11px] font-medium tracking-wide text-ink-40 uppercase">
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

      <p className="text-[11px] text-ink-45">
        Refreshes automatically every {REFRESH_MS / 1000} seconds while this tab
        is visible.
      </p>
    </main>
  );
}
