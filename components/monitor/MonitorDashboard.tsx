"use client";

import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { MonitorSnapshot, ServiceStatus } from "@/lib/monitor";
import { SERVICE_IDS, SERVICE_LABELS, type ServiceId } from "@/lib/services/ids";
import type { ServiceSnapshotMap } from "@/lib/services/registry";
import { ConfirmProvider } from "@/components/admin/Confirm";
import PageNav from "@/components/PageNav";
import QbittorrentCard from "./QbittorrentCard";
import ArrCard from "./ArrCard";
import AdguardCard from "./AdguardCard";
import TautulliCard from "./TautulliCard";
import SeerrCard from "./SeerrCard";
import PortainerCard from "./PortainerCard";
import TruenasCard from "./TruenasCard";
import UnifiCard from "./UnifiCard";

// The private Monitor page's body (#207): a card per configured integration,
// server-rendered from the shared snapshot cache and then kept fresh by
// polling /api/monitor — which serves that same cache, so however many tabs
// sit on this page the services see one fetch per window. Unconfigured
// services collapse into a single "connect more" hint instead of empty cards.

const REFRESH_MS = 45_000;

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

// "qBittorrent, Sonarr, or Radarr" — prose list of every service, so the
// empty-state copy names whatever the registry currently holds.
function serviceList(): string {
  const labels = SERVICE_IDS.map((id) => SERVICE_LABELS[id]);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
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

  const configured = SERVICE_IDS.filter((id) => snapshot[id].configured);
  const unconfigured = SERVICE_IDS.filter((id) => !snapshot[id].configured);

  const settingsLink = "/admin?tab=settings&section=integrations";

  return (
    <ConfirmProvider>
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
            Connect {serviceList()} and their live status appears here.
            Credentials stay on the server — cards on this page only ever
            receive the resulting numbers.
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
          {configured.map((id) => (
            <Fragment key={id}>{renderCard(id, snapshot, refresh)}</Fragment>
          ))}
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
    </ConfirmProvider>
  );
}
