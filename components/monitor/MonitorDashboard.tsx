"use client";

import type { NavPages } from "@/lib/nav";
import { useCallback, useEffect, useState } from "react";
import type { MonitorEntry, MonitorSnapshot } from "@/lib/monitor";
import { MONITOR_GROUPS, SERVICE_IDS, SERVICE_META } from "@/lib/services/ids";
import PageNav from "@/components/PageNav";
import ReauthDialog from "@/components/admin/ReauthDialog";
import CommandDeck from "./CommandDeck";
import Complication from "./Complication";
import { sinceLabel, type ServiceState } from "./state";
import { tileContent, type GlanceVisual } from "./glances";
import { LiveDot } from "./kit";
import { settingsCardId } from "@/lib/nav";
import Link from "next/link";
import { buttonClasses } from "@/lib/buttons";
import { usePolling } from "@/components/usePolling";
import { useNow } from "@/components/useNow";

// The private Monitor cockpit (#207, #208): one cohesive "instrument face" — a
// system-health hero over domain-grouped clusters of clickable complications,
// server-rendered from the shared snapshot cache and kept fresh by polling
// /api/monitor (that same cache, so however many tabs are open the services see
// one fetch per window). Every integration holds a tile, ordered by its type's
// cluster, several of a type side by side (#300), in one flow that fills the
// width (#520); a configured one drills into its
// detail page, a switched-off one dims and points at its settings, and the
// types nobody has set up share one quiet row at the end. The read-only
// depth (full lists, actions) lives on /admin/monitor/[id].

// Every few seconds (#531): each service's snapshot is only refetched once
// its own live rate has passed (lib/monitor.ts), so a quick poll costs the
// slow services nothing.
const REFRESH_MS = 5_000;
// An off tile opens its integration's settings card (#277); a type not set
// up links to the Integrations section to add one.
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

// One integration's complication: the shared tile content (the board tiles
// use the same, #301) plus where it links. `now` (null until mounted)
// drives relative dates.
function complicationFor(entry: MonitorEntry, now: number | null): ComplicationProps {
  const content = tileContent(entry, now, "admin");
  const offOrNew = content.state === "disabled" || content.state === "unconfigured";
  return {
    ...content,
    href: offOrNew ? settingsLink(entry.label) : `/admin/monitor/${encodeURIComponent(entry.id)}`,
  };
}

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
  // A clock for the relative dates ("in 3d") and the freshness label.
  // Client-time; null until mount, and never behind the last refresh.
  const clock = useNow(5_000);
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

  // The types nobody has set up (#509): one quiet row at the end, rather
  // than a dimmed tile in every group.
  const unused = SERVICE_IDS.filter((t) => !snapshot.some((e) => e.type === t));

  return (
    <main id="main-content" className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-6 px-6 pt-12 pb-24 sm:px-10 lg:pt-16">
      {/* "Confirm it's you" for the destructive actions (#366). */}
      <ReauthDialog />
      <div>
        <PageNav current={null} {...nav} />
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Monitor</h1>
            <p className="mt-1 text-sm text-ink-50">
              Live status of the services you&apos;ve connected. Only admins see this page.
            </p>
          </div>
          {/* The freshness read, as on the integration pages: live, and how
              long ago the last refresh came back. */}
          {updatedAt !== null && now !== null && (
            <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-fg/10 bg-fg/5 px-3.5 py-1.5 text-xs whitespace-nowrap">
              <LiveDot state={now - updatedAt > 3 * REFRESH_MS ? "stale" : "live"} />
              <span className="font-medium text-ink-80">Live</span>
              <span className="text-ink-40">· updated {sinceLabel(now - updatedAt)}</span>
            </span>
          )}
        </div>
      </div>

      {/* The command deck, then every integration's tile in one flow that
          fills the width (#520): ordered by domain, three to a row, the last
          row's tiles growing to close it, so no group leaves a hole beside
          it. Every surface is a glass-card, so the page takes on the active
          design. */}
      <div className="flex flex-col gap-6">
        <CommandDeck snapshot={snapshot} now={now} />
        {snapshot.length > 0 && (
          <section aria-labelledby="monitor-services" className="flex flex-wrap gap-3">
            <h2 id="monitor-services" className="sr-only">
              Services
            </h2>
            {MONITOR_GROUPS.flatMap((group) => snapshot.filter((e) => SERVICE_META[e.type].group === group)).map(
              (entry) => (
                <Complication key={entry.id} label={entry.label} {...complicationFor(entry, now)} />
              )
            )}
          </section>
        )}
        {unused.length > 0 && (
          <section
            aria-label="Not set up yet"
            className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[var(--surface-radius)] border border-dashed border-fg/15 px-5 py-4"
          >
            <p className="text-sm text-ink-60">
              {snapshot.length === 0 ? "Connect a service to see it here." : "Not set up yet"}
            </p>
            <div className="flex flex-wrap gap-2">
              {unused.map((type) => (
                <Link key={type} href={SETTINGS} className={buttonClasses("ghost", "sm")}>
                  + {SERVICE_META[type].label}
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
