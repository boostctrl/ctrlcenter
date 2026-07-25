"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { DetailResult } from "@/lib/monitor-detail";
import type { ServiceStatus } from "@/lib/monitor";
import { SERVICE_LABELS } from "@/lib/services/ids";
import { ConfirmProvider } from "@/components/admin/Confirm";
import PageNav from "@/components/PageNav";
import {
  InDetailContext,
  serviceState,
  sinceLabel,
  STATE_DOT,
  type ServiceState,
} from "./MonitorCard";
import QbittorrentDetail from "./detail/QbittorrentDetail";
import AdguardDetail from "./detail/AdguardDetail";
import TautulliDetail from "./detail/TautulliDetail";
import UnifiDetail from "./detail/UnifiDetail";
import ArrCard from "./ArrCard";
import SeerrCard from "./SeerrCard";
import PortainerCard from "./PortainerCard";
import TruenasCard from "./TruenasCard";

// The client shell for a service's detail page (#208): the shared chrome
// (back-to-Monitor breadcrumb, title) plus a poll of /api/monitor/[id] that
// keeps the body fresh, and hands the body a `refresh` so a completed action
// reflects at once. The body is picked per service from the discriminated
// result — qBittorrent has a purpose-built rich body; every other service's
// full card renders here as its detail (the depth that left the glance face),
// which also relocates the Seerr/Portainer actions onto the detail page.

const REFRESH_MS = 30_000;
// How often the masthead's "updated Xs ago" label re-ticks between polls, so
// the freshness read feels live without waiting a full refresh cycle.
const CLOCK_MS = 10_000;

// The masthead's live status pill: the same dot vocabulary the cockpit tiles
// use, a one-word health read, and — while data is flowing — how long ago it
// last refreshed. `now`/`updatedAt` are null until mount so the relative label
// can't mismatch on hydration.
function StatusPill({
  state,
  updatedAt,
  now,
}: {
  state: ServiceState;
  updatedAt: number | null;
  now: number | null;
}) {
  const label =
    state === "live" ? "Live" : state === "stale" ? "Stale" : "Offline";
  const since =
    state !== "unreachable" && updatedAt !== null && now !== null
      ? sinceLabel(now - updatedAt)
      : null;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-fg/10 bg-fg/5 px-3.5 py-1.5 text-xs">
      <span aria-hidden className={`h-2 w-2 rounded-full ${STATE_DOT[state]}`} />
      <span className="font-medium text-fg/80">{label}</span>
      {since && <span className="text-fg/40">· updated {since}</span>}
    </span>
  );
}

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
      return <AdguardDetail status={asStatus(result)} />;
    case "tautulli":
      return <TautulliDetail status={asStatus(result)} />;
    case "seerr":
      return <SeerrCard status={asStatus(result)} onActed={refresh} />;
    case "portainer":
      return <PortainerCard status={asStatus(result)} onActed={refresh} />;
    case "truenas":
      return <TruenasCard status={asStatus(result)} />;
    case "unifi":
      return <UnifiDetail status={asStatus(result)} />;
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
  // When the shown data last came back fresh, and a client clock that ticks
  // between polls — both null until mount so the "updated Xs ago" label can't
  // mismatch on hydration, then set on first paint and on every good refresh.
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch(`/api/monitor/${id}`);
      if (!res.ok) return; // keep the last result; the body shows its own errors
      setResult((await res.json()) as DetailResult);
      const at = Date.now();
      setUpdatedAt(at);
      setNow(at);
    } catch {
      // Network blip — the interval will try again.
    }
  }, [id]);

  useEffect(() => {
    // After paint (not synchronously) so the relative freshness label appears
    // without risking a hydration mismatch on the first render.
    const raf = requestAnimationFrame(() => {
      const at = Date.now();
      setUpdatedAt(at);
      setNow(at);
    });
    const refreshTimer = setInterval(refresh, REFRESH_MS);
    const clockTimer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(refreshTimer);
      clearInterval(clockTimer);
    };
  }, [refresh]);

  // The live health read, from the same serviceState the cockpit tiles use. A
  // detail page only renders for a configured service, so those flags are fixed
  // true; data/error carry the live result.
  const state = serviceState({
    configured: true,
    enabled: true,
    urlSet: true,
    data: result.data,
    error: result.error,
  });

  return (
    <ConfirmProvider>
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-12 sm:px-10 lg:py-16">
        {/* The detail masthead: breadcrumb, then the service name paired with a
            live status pill, so every service opens on the same designed header
            instead of a bare title over an empty band. */}
        <div className="flex flex-col gap-4">
          <div>
            <PageNav current={null} {...nav} />
            {/* Breadcrumb back to the cockpit — a plain text link, no arrow. */}
            <Link
              href="/admin/monitor"
              className="mt-3 inline-block text-sm text-fg/50 transition-colors hover:text-fg/80"
            >
              Monitor
            </Link>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <h1 className="text-3xl font-bold">{SERVICE_LABELS[id]}</h1>
            <StatusPill state={state} updatedAt={updatedAt} now={now} />
          </div>
        </div>
        <InDetailContext.Provider value={true}>
          {renderBody(result, refresh)}
        </InDetailContext.Provider>
      </main>
    </ConfirmProvider>
  );
}
