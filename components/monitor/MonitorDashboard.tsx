"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MonitorSnapshot } from "@/lib/monitor";
import PageNav from "@/components/PageNav";
import QbittorrentCard from "./QbittorrentCard";
import ArrCard from "./ArrCard";

// The private Monitor page's body (#207): a card per configured integration,
// server-rendered from the shared snapshot cache and then kept fresh by
// polling /api/monitor — which serves that same cache, so however many tabs
// sit on this page the services see one fetch per window. Unconfigured
// services collapse into a single "connect more" hint instead of empty cards.

const REFRESH_MS = 45_000;

const SERVICE_LABELS: Record<keyof MonitorSnapshot, string> = {
  qbittorrent: "qBittorrent",
  sonarr: "Sonarr",
  radarr: "Radarr",
};

export default function MonitorDashboard({
  initial,
  nav,
}: {
  initial: MonitorSnapshot;
  nav: { weather: boolean; status: boolean; calendar: boolean };
}) {
  const [snapshot, setSnapshot] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      // A backgrounded tab shouldn't keep the services warm.
      if (document.hidden) return;
      try {
        const res = await fetch("/api/monitor");
        if (!res.ok) return; // keep the last snapshot; cards show their own errors
        const next = (await res.json()) as MonitorSnapshot;
        if (!cancelled) setSnapshot(next);
      } catch {
        // Network blip — the interval will try again.
      }
    };
    const timer = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const configured = (
    Object.keys(SERVICE_LABELS) as (keyof MonitorSnapshot)[]
  ).filter((id) => snapshot[id].configured);
  const unconfigured = (
    Object.keys(SERVICE_LABELS) as (keyof MonitorSnapshot)[]
  ).filter((id) => !snapshot[id].configured);

  const settingsLink = "/admin?tab=settings&section=integrations";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-8 px-6 py-12 sm:px-10 lg:py-16">
      <div>
        <PageNav current={null} {...nav} />
        <h1 className="mt-3 text-3xl font-bold">Monitor</h1>
        <p className="mt-1 text-sm text-fg/45">
          A read-only view of your connected services. Only signed-in admins
          can see this page — nothing here is ever shown to visitors.
        </p>
      </div>

      {configured.length === 0 ? (
        <div className="glass-card flex flex-col items-start gap-3 p-8">
          <h2 className="text-lg font-semibold">No integrations connected yet</h2>
          <p className="max-w-prose text-sm text-fg/60">
            Connect qBittorrent, Sonarr, or Radarr and their live status
            appears here. Credentials stay on the server — cards on this page
            only ever receive the resulting numbers.
          </p>
          <Link
            href={settingsLink}
            className="text-sm text-[var(--accent-from)] hover:underline"
          >
            Set up integrations
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {snapshot.qbittorrent.configured && (
            <QbittorrentCard status={snapshot.qbittorrent} />
          )}
          {snapshot.sonarr.configured && (
            <ArrCard title="Sonarr" status={snapshot.sonarr} />
          )}
          {snapshot.radarr.configured && (
            <ArrCard title="Radarr" status={snapshot.radarr} />
          )}
          {unconfigured.length > 0 && (
            <div className="flex min-h-32 flex-col items-start justify-center gap-2 rounded-2xl border border-dashed border-fg/15 p-6">
              <p className="text-sm text-fg/50">
                Not connected: {unconfigured.map((id) => SERVICE_LABELS[id]).join(", ")}
              </p>
              <Link
                href={settingsLink}
                className="text-sm text-[var(--accent-from)] hover:underline"
              >
                Set up integrations
              </Link>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-fg/35">
        Refreshes automatically every {REFRESH_MS / 1000} seconds while this
        tab is visible.
      </p>
    </main>
  );
}
