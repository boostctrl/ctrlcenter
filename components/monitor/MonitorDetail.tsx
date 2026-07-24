"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { DetailResult } from "@/lib/monitor-detail";
import type { ServiceStatus } from "@/lib/monitor";
import { SERVICE_LABELS } from "@/lib/services/ids";
import { ConfirmProvider } from "@/components/admin/Confirm";
import PageNav from "@/components/PageNav";
import QbittorrentDetail from "./detail/QbittorrentDetail";
import ArrCard from "./ArrCard";
import AdguardCard from "./AdguardCard";
import TautulliCard from "./TautulliCard";
import SeerrCard from "./SeerrCard";
import PortainerCard from "./PortainerCard";
import TruenasCard from "./TruenasCard";
import UnifiCard from "./UnifiCard";

// The client shell for a service's detail page (#208): the shared chrome
// (back-to-Monitor breadcrumb, title) plus a poll of /api/monitor/[id] that
// keeps the body fresh, and hands the body a `refresh` so a completed action
// reflects at once. The body is picked per service from the discriminated
// result — qBittorrent has a purpose-built rich body; every other service's
// full card renders here as its detail (the depth that left the glance face),
// which also relocates the Seerr/Portainer actions onto the detail page.

const REFRESH_MS = 30_000;

// Reconstruct a ServiceStatus for a card body. A detail page only renders for a
// configured service (getServiceDetail 404s otherwise), so the config flags are
// fixed true; data/error/actionsAllowed carry the live read.
function asStatus<T>(r: {
  actionsAllowed: boolean;
  data: T | null;
  error: string | null;
}): ServiceStatus<T> {
  return {
    configured: true,
    enabled: true,
    urlSet: true,
    actionsAllowed: r.actionsAllowed,
    data: r.data,
    error: r.error,
    at: null,
  };
}

function renderBody(result: DetailResult, refresh: () => void): ReactNode {
  switch (result.service) {
    case "qbittorrent":
      return (
        <QbittorrentDetail
          data={result.data}
          error={result.error}
          actionsAllowed={result.actionsAllowed}
          onActed={refresh}
        />
      );
    case "sonarr":
      return <ArrCard title="Sonarr" status={asStatus(result)} />;
    case "radarr":
      return <ArrCard title="Radarr" status={asStatus(result)} />;
    case "adguard":
      return <AdguardCard status={asStatus(result)} />;
    case "tautulli":
      return <TautulliCard status={asStatus(result)} />;
    case "seerr":
      return <SeerrCard status={asStatus(result)} onActed={refresh} />;
    case "portainer":
      return <PortainerCard status={asStatus(result)} onActed={refresh} />;
    case "truenas":
      return <TruenasCard status={asStatus(result)} />;
    case "unifi":
      return <UnifiCard status={asStatus(result)} />;
  }
}

export default function MonitorDetail({
  initial,
  nav,
}: {
  initial: DetailResult;
  nav: { weather: boolean; status: boolean; calendar: boolean };
}) {
  const [result, setResult] = useState(initial);
  const id = initial.service;

  const refresh = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch(`/api/monitor/${id}`);
      if (!res.ok) return; // keep the last result; the body shows its own errors
      setResult((await res.json()) as DetailResult);
    } catch {
      // Network blip — the interval will try again.
    }
  }, [id]);

  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <ConfirmProvider>
      <main className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-6 px-6 py-12 sm:px-10 lg:py-16">
        <div>
          <PageNav current={null} {...nav} />
          {/* Breadcrumb back to the cockpit — a plain text link, no arrow. */}
          <Link
            href="/admin/monitor"
            className="mt-3 inline-block text-sm text-fg/50 transition-colors hover:text-fg/80"
          >
            Monitor
          </Link>
          <h1 className="mt-1 text-3xl font-bold">{SERVICE_LABELS[id]}</h1>
        </div>
        {renderBody(result, refresh)}
      </main>
    </ConfirmProvider>
  );
}
