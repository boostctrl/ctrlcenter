"use client";

import type { NavPages } from "@/lib/nav";
import { useCallback, useEffect, useState } from "react";
import type { MonitorEntry, MonitorSnapshot } from "@/lib/monitor";
import { MONITOR_GROUPS, SERVICE_IDS, SERVICE_META, type ServiceId } from "@/lib/services/ids";
import PageNav from "@/components/PageNav";
import SystemHealthBar from "./SystemHealthBar";
import Complication from "./Complication";
import { serviceState, sinceLabel, type ServiceState } from "./MonitorCard";
import { GLANCES, type Glance, type GlanceVisual } from "./glances";
import { settingsCardId } from "@/lib/nav";
import { usePolling } from "@/components/usePolling";
import { useNow } from "@/components/useNow";

// The private Monitor cockpit (#207, #208): one cohesive "instrument face" — a
// system-health hero over domain-grouped clusters of clickable complications,
// server-rendered from the shared snapshot cache and kept fresh by polling
// /api/monitor (that same cache, so however many tabs are open the services see
// one fetch per window). Every integration holds a tile in its type's cluster,
// several of a type side by side (#300); a configured one drills into its
// detail page, a switched-off one dims and points at its settings, and a type
// with none set up keeps a dimmed "set up" slot — so the face reads as one
// designed surface whether one service is in use or a dozen. The read-only
// depth (full lists, actions) lives on /admin/monitor/[id].

const REFRESH_MS = 45_000;
// An off tile opens its integration's settings card (#277); a "set up" slot
// opens the Integrations section to add one.
const SETTINGS = "/admin?tab=settings&section=integrations";
const settingsLink = (label: string) => `${SETTINGS}#${settingsCardId(label)}`;

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

// A type's glance from an entry's data. The entry's type and data are
// correlated by construction; the cast restores what the union loses.
function glanceFor(entry: MonitorEntry, now: number | null): Glance {
  const extract = GLANCES[entry.type] as (data: unknown, now: number | null) => Glance;
  return extract(entry.data, now);
}

// One integration's complication content from its status. The three non-data
// states get standardized gauge dials; live/stale defer to the type's glance
// extractor. `now` (null until mounted) drives relative dates.
function complicationFor(entry: MonitorEntry, now: number | null): ComplicationProps {
  const state = serviceState(entry);
  const detail = `/admin/monitor/${encodeURIComponent(entry.id)}`;
  if (state === "disabled")
    return { state, href: settingsLink(entry.label), center: "Off", caption: "", lines: ["Turned off"] };
  if (state === "unconfigured")
    return {
      state,
      href: settingsLink(entry.label),
      center: "+",
      caption: "set up",
      lines: ["Not connected"],
    };
  if (state === "unreachable")
    return {
      state,
      href: detail,
      center: "!",
      caption: "offline",
      alert: true,
      lines: [entry.error ?? "Can’t reach"],
    };
  // live / stale: data is present, so the glance extractor can read it.
  return { state, href: detail, ...glanceFor(entry, now) };
}

// A type nobody has set up keeps a dimmed slot in its cluster.
const setUpSlot = (type: ServiceId): ComplicationProps & { label: string } => ({
  label: SERVICE_META[type].label,
  state: "unconfigured",
  href: SETTINGS,
  center: "+",
  caption: "set up",
  lines: ["Not connected"],
});

export default function MonitorDashboard({
  initial,
  nav,
}: {
  initial: MonitorSnapshot;
  nav: NavPages;
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
        {MONITOR_GROUPS.map((group) => {
          const types = SERVICE_IDS.filter((t) => SERVICE_META[t].group === group);
          const entries = snapshot.filter((e) => SERVICE_META[e.type].group === group);
          const unused = types.filter((t) => !entries.some((e) => e.type === t));
          return (
            <section key={group} className="flex flex-col gap-4">
              <p className="text-[11px] font-medium tracking-wide text-ink-40 uppercase">{group}</p>
              <div className="flex flex-wrap gap-3">
                {entries.map((entry) => (
                  <Complication key={entry.id} label={entry.label} {...complicationFor(entry, now)} />
                ))}
                {unused.map((type) => (
                  <Complication key={`setup-${type}`} {...setUpSlot(type)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-[11px] text-ink-45">
        Refreshes automatically every {REFRESH_MS / 1000} seconds while this tab
        is visible.
      </p>
    </main>
  );
}
