"use client";

import type { NavPages } from "@/lib/nav";
import Link from "next/link";
import { buttonClasses } from "@/lib/buttons";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { DetailResult } from "@/lib/monitor-detail";
import { MonitorIntegrationContext } from "./actions";
import Icon from "@/components/Icon";
import { settingsCardId } from "@/lib/nav";
import { SERVICE_META } from "@/lib/services/ids";
import { OfflineState, StaleNotice } from "./kit";
import { ConfirmProvider } from "@/components/admin/Confirm";
import ReauthDialog from "@/components/admin/ReauthDialog";
import PageNav from "@/components/PageNav";
import { usePolling } from "@/components/usePolling";
import { useNow } from "@/components/useNow";
import {
  serviceState,
  sinceLabel,
  STATE_DOT,
  type ServiceState,
} from "./state";
import QbittorrentDetail from "./detail/QbittorrentDetail";
import AdguardDetail from "./detail/AdguardDetail";
import TautulliDetail from "./detail/TautulliDetail";
import UnifiDetail from "./detail/UnifiDetail";
import ArrDetail from "./detail/ArrDetail";
import SeerrDetail from "./detail/SeerrDetail";
import PortainerDetail from "./detail/PortainerDetail";
import TruenasDetail from "./detail/TruenasDetail";

// The client shell for a service's page (#208): the shared header
// (breadcrumb, logo, name, status, #508) plus a poll of /api/monitor/[id]
// that keeps the body fresh, and hands the body a `refresh` so a completed
// action reflects at once. With no data it shows the offline state; else
// the body is picked per service from the discriminated result, each built
// on the page kit (components/monitor/kit).

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
      <span className="font-medium text-ink-80">{label}</span>
      {since && <span className="text-ink-40">· updated {since}</span>}
    </span>
  );
}

function renderBody(result: DetailResult, refresh: () => void): ReactNode {
  switch (result.service) {
    case "qbittorrent":
      return (
        result.data && (
          <QbittorrentDetail data={result.data} actionsAllowed={result.actionsAllowed} onActed={refresh} />
        )
      );
    case "sonarr":
    case "radarr":
      return result.data && <ArrDetail kind={result.service} data={result.data} />;
    case "adguard":
      return result.data && <AdguardDetail data={result.data} />;
    case "tautulli":
      return result.data && <TautulliDetail data={result.data} />;
    case "seerr":
      return (
        result.data && <SeerrDetail data={result.data} actionsAllowed={result.actionsAllowed} onActed={refresh} />
      );
    case "portainer":
      return (
        result.data && <PortainerDetail data={result.data} actionsAllowed={result.actionsAllowed} onActed={refresh} />
      );
    case "truenas":
      return result.data && <TruenasDetail data={result.data} />;
    case "unifi":
      return result.data && <UnifiDetail data={result.data} />;
  }
}

export default function MonitorDetail({
  initial,
  nav,
}: {
  initial: DetailResult;
  nav: NavPages;
}) {
  const [result, setResult] = useState(initial);
  const id = initial.id;
  // When the shown data last came back fresh, and a client clock that ticks
  // between polls — the label is hidden until mount so it can't mismatch on
  // hydration, then set on first paint and on every good refresh.
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const clock = useNow(CLOCK_MS);
  const now = updatedAt === null ? null : Math.max(clock, updatedAt);

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const res = await fetch(`/api/monitor/${encodeURIComponent(id)}`, { signal });
        if (!res.ok) return; // keep the last result; the body shows its own errors
        const next = (await res.json()) as DetailResult;
        if (signal.aborted) return;
        // A failed refresh keeps what the page already shows, marked stale
        // (#508), rather than blanking a page that was fine a moment ago.
        if (next.data === null) {
          setResult((prev) => (prev.data === null ? next : ({ ...prev, error: next.error } as DetailResult)));
          return;
        }
        setResult(next);
        setUpdatedAt(Date.now());
      } catch {
        // Network blip — the next poll will try again.
      }
    },
    [id]
  );
  // Seeded with server data, so the first poll waits a full interval; a card
  // action calls `refresh` to reflect its change right away.
  const refresh = usePolling(load, REFRESH_MS, { immediate: false });

  useEffect(() => {
    // After paint (not synchronously) so the relative freshness label appears
    // without risking a hydration mismatch on the first render.
    const raf = requestAnimationFrame(() => setUpdatedAt(Date.now()));
    return () => cancelAnimationFrame(raf);
  }, []);

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

  const meta = SERVICE_META[result.service];
  const settingsHref = `/admin?tab=settings&section=integrations#${settingsCardId(result.label)}`;
  return (
    <ConfirmProvider>
      {/* "Confirm it's you" for the destructive actions (#366). */}
      <ReauthDialog />
      <main id="main-content" className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-6 px-6 pt-12 pb-24 sm:px-10 lg:pt-16">
        {/* The page header (#508): the way back, then the service's logo,
            name and what it is, with the live status pill across from them. */}
        <div className="flex flex-col gap-5">
          <div>
            <PageNav current={null} {...nav} />
            <nav aria-label="Breadcrumb" className="mt-3 text-sm text-ink-50">
              <Link href="/admin/monitor" className="transition-colors hover:text-ink-80">
                Monitor
              </Link>
              <span aria-hidden className="mx-2 text-ink-30">/</span>
              <span aria-current="page" className="text-ink-70">
                {result.label}
              </span>
            </nav>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="flex min-w-0 items-center gap-4">
              <span className="glass-card flex h-14 w-14 shrink-0 items-center justify-center [--surface-lift:0px]">
                <Icon icon={meta.icon} name={meta.label} size={30} />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-3xl font-bold tracking-tight">{result.label}</h1>
                <p className="text-sm text-ink-50">
                  {result.label === meta.label ? meta.tagline : `${meta.label} · ${meta.tagline}`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {result.openUrl && (
                <a
                  href={result.openUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClasses("ghost", "sm")}
                >
                  Open {meta.label}
                  <span className="sr-only"> in a new tab</span>
                </a>
              )}
              <StatusPill state={state} updatedAt={updatedAt} now={now} />
            </div>
          </div>
        </div>
        {result.data === null ? (
          <OfflineState label={result.label} error={result.error} settingsHref={settingsHref} />
        ) : (
          <>
            {result.error && (
              <StaleNotice
                error={result.error}
                since={updatedAt !== null && now !== null ? sinceLabel(now - updatedAt) : null}
              />
            )}
            <MonitorIntegrationContext.Provider value={id}>
              {renderBody(result, refresh)}
            </MonitorIntegrationContext.Provider>
          </>
        )}
      </main>
    </ConfirmProvider>
  );
}
