"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { MonitorSnapshot, ServiceStatus } from "@/lib/monitor";
import { SERVICE_IDS, type ServiceId } from "@/lib/services/ids";
import type { ServiceSnapshotMap } from "@/lib/services/registry";
import { ConfirmProvider } from "@/components/admin/Confirm";
import PageNav from "@/components/PageNav";
import SystemHealthBar from "./SystemHealthBar";
import QbittorrentCard from "./QbittorrentCard";
import ArrCard from "./ArrCard";
import AdguardCard from "./AdguardCard";
import TautulliCard from "./TautulliCard";
import SeerrCard from "./SeerrCard";
import PortainerCard from "./PortainerCard";
import TruenasCard from "./TruenasCard";
import UnifiCard from "./UnifiCard";

// The private Monitor cockpit (#207, #208): a system-health bar over a fixed
// bento of one tile per integration, server-rendered from the shared snapshot
// cache and then kept fresh by polling /api/monitor — which serves that same
// cache, so however many tabs sit on this page the services see one fetch per
// window. Every service always occupies its tile; a disabled, not-set-up, or
// unreachable service renders a graceful placeholder at that same size
// (MonitorCard owns those states), so the mosaic never leaves a hole.

const REFRESH_MS = 45_000;

// The opinionated bento: each service's fixed footprint. The classes read as a
// 4-column mosaic (at `xl`) that folds to two columns at `md` and one on phones.
// The three richest, most-glanced services (qBittorrent's torrents, Portainer's
// containers, TrueNAS's pools/alerts) get the large 2×2 tiles; the *arr queues a
// tall 1×2; the summary/stat services (Seerr, Tautulli, AdGuard, UniFi) fill the
// 1×1 gaps. Defaults (unspanned) are 1×1, so only the larger tiles carry a
// class. The spans sum to a clean 20-cell rectangle (5 rows × 4 cols at `xl`),
// which dense auto-flow packs gaplessly; the layout is not user-arrangeable.
const BENTO: Record<ServiceId, string> = {
  qbittorrent: "md:col-span-2 md:row-span-2",
  portainer: "md:col-span-2 md:row-span-2",
  truenas: "md:col-span-2 md:row-span-2",
  sonarr: "md:row-span-2",
  radarr: "md:row-span-2",
  seerr: "",
  tautulli: "",
  adguard: "",
  unifi: "",
};

// One card renderer per service, keyed by the shared ServiceId union (#212):
// a service without a card is a compile error, not a configured service that
// silently never renders. Action-capable cards (#201/#202/#203) take `onActed`
// to refetch the snapshot right after a successful action; the rest ignore it.
const CARDS: {
  [K in ServiceId]: (
    status: ServiceStatus<ServiceSnapshotMap[K]>,
    onActed: () => void
  ) => ReactNode;
} = {
  qbittorrent: (status, onActed) => (
    <QbittorrentCard status={status} onActed={onActed} />
  ),
  sonarr: (status) => <ArrCard title="Sonarr" status={status} />,
  radarr: (status) => <ArrCard title="Radarr" status={status} />,
  adguard: (status) => <AdguardCard status={status} />,
  tautulli: (status) => <TautulliCard status={status} />,
  seerr: (status, onActed) => <SeerrCard status={status} onActed={onActed} />,
  portainer: (status, onActed) => (
    <PortainerCard status={status} onActed={onActed} />
  ),
  truenas: (status) => <TruenasCard status={status} />,
  unifi: (status) => <UnifiCard status={status} />,
};

// Generic so the id stays correlated with its slice of the snapshot — indexing
// with the plain union would decouple the card from its payload type.
function renderCard<K extends ServiceId>(
  id: K,
  snapshot: MonitorSnapshot,
  onActed: () => void
): ReactNode {
  return CARDS[id](snapshot[id], onActed);
}

export default function MonitorDashboard({
  initial,
  nav,
}: {
  initial: MonitorSnapshot;
  nav: { weather: boolean; status: boolean; calendar: boolean };
}) {
  const [snapshot, setSnapshot] = useState(initial);

  // Refetch the shared snapshot. Drives the poll and is handed to the
  // action-capable cards so a completed action reflects at once instead of
  // waiting out the interval. A setState after unmount is a harmless no-op in
  // React 19, so no cancellation bookkeeping is needed.
  const refresh = useCallback(async () => {
    // A backgrounded tab shouldn't keep the services warm.
    if (document.hidden) return;
    try {
      const res = await fetch("/api/monitor");
      if (!res.ok) return; // keep the last snapshot; cards show their own errors
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
    <ConfirmProvider>
    <main className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-6 px-6 py-12 sm:px-10 lg:py-16">
      <div>
        <PageNav current={null} {...nav} />
        <h1 className="mt-3 text-3xl font-bold">Monitor</h1>
        <p className="mt-1 text-sm text-fg/45">
          A read-only view of your connected services. Only signed-in admins
          can see this page — nothing here is ever shown to visitors.
        </p>
      </div>

      <SystemHealthBar snapshot={snapshot} />

      {/* The bento: a fixed tile per service. Auto-rows give each tile a
          definite height at md+ so its body can scroll internally instead of
          stretching the row; on phones the grid is a single natural-height
          column. */}
      <div className="grid grid-cols-1 gap-4 md:auto-rows-[13rem] md:grid-flow-row-dense md:grid-cols-2 xl:grid-cols-4">
        {SERVICE_IDS.map((id) => (
          <div key={id} className={BENTO[id]}>
            {renderCard(id, snapshot, refresh)}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-fg/35">
        Refreshes automatically every {REFRESH_MS / 1000} seconds while this
        tab is visible.
      </p>
    </main>
    </ConfirmProvider>
  );
}
