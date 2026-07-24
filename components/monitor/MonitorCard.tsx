"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ServiceStatus } from "@/lib/monitor";
import { buttonClasses } from "@/lib/buttons";
import { formatBytes } from "@/components/widgets/SystemStatsWidget";

// Shared chrome for one integration's tile on the Monitor cockpit (#207, #208).
// Every service renders a tile at all times — the graceful-degradation states
// live here, in one place, so all nine degrade with the same visual language
// instead of each card reinventing an empty state (or, worse, leaving a hole in
// the bento). A tile is always a glass card with a health dot, the service
// name, and a body that is either the card's live content or one of the
// standardized placeholders below.

// The five states a tile can be in, derived from one ServiceStatus:
//   live         — fresh data, no trouble
//   stale        — last-good data while a refresh is failing
//   unreachable  — configured but never answered (calm offline, not a red mess)
//   disabled     — has a URL but the enable toggle is off (off, not broken)
//   unconfigured — no URL yet (an inviting onboarding tile)
export type ServiceState =
  | "live"
  | "stale"
  | "unreachable"
  | "disabled"
  | "unconfigured";

export function serviceState(
  status: Pick<
    ServiceStatus<unknown>,
    "configured" | "enabled" | "urlSet" | "data" | "error"
  >
): ServiceState {
  if (status.data) return status.error ? "stale" : "live";
  if (status.configured) return "unreachable";
  // Not configured: a URL with the toggle off is a deliberate "off"; no URL is
  // simply not set up yet (this also folds in enabled-but-URL-blank half-setups).
  return status.urlSet && !status.enabled ? "disabled" : "unconfigured";
}

// Whether a state shows the card's own live content vs. a placeholder body.
function hasData(state: ServiceState): boolean {
  return state === "live" || state === "stale";
}

// The header dot's tone per state — the at-a-glance health read, shared with the
// SystemHealthBar's tally so a dot means the same thing everywhere.
export const STATE_DOT: Record<ServiceState, string> = {
  live: "bg-emerald-400",
  stale: "bg-amber-400",
  unreachable: "bg-red-400",
  disabled: "bg-fg/25",
  unconfigured: "border border-dashed border-fg/30",
};

const SETTINGS_LINK = "/admin?tab=settings&section=integrations";

// The three non-data bodies. Kept deliberately calm and centered so a cockpit
// that is mostly unconfigured still reads as designed rather than broken.
function OfflineBody({ title, error }: { title: string; error: string | null }) {
  return (
    <Placeholder
      icon={
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-6 w-6">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      }
      tone="text-fg/30"
    >
      <p className="text-sm text-fg/55">Can’t reach {title}</p>
      {error && <p className="max-w-[22ch] text-xs text-fg/35">{error}</p>}
    </Placeholder>
  );
}

function DisabledBody() {
  return (
    <Placeholder
      icon={
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-6 w-6">
          <path d="M12 3v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path
            d="M6.5 7a8 8 0 1 0 11 0"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      }
      tone="text-fg/25"
    >
      <p className="text-sm text-fg/45">Disabled</p>
      <Link href={SETTINGS_LINK} className={buttonClasses("ghost", "sm")}>
        Enable in Settings
      </Link>
    </Placeholder>
  );
}

function ConnectBody({ title }: { title: string }) {
  return (
    <Placeholder
      icon={
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-6 w-6">
          <path
            d="M12 6v12M6 12h12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      }
      tone="text-[var(--accent-from)]/70"
    >
      <p className="text-sm text-fg/55">Connect {title}</p>
      <Link href={SETTINGS_LINK} className={buttonClasses("ghost", "sm")}>
        Set up
      </Link>
    </Placeholder>
  );
}

function Placeholder({
  icon,
  tone,
  children,
}: {
  icon: ReactNode;
  tone: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <span className={tone}>{icon}</span>
      {children}
    </div>
  );
}

export default function MonitorCard({
  title,
  status,
  children,
}: {
  title: string;
  status: ServiceStatus<unknown>;
  children?: ReactNode;
}) {
  const state = serviceState(status);
  const showData = hasData(state);
  return (
    <section className="glass-card flex h-full flex-col gap-3 p-5">
      <div className="flex items-baseline justify-between gap-3 border-b border-fg/10 pb-2.5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg/90">
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT[state]}`}
          />
          {title}
        </h2>
        {state === "stale" && status.error && (
          <span className="text-right text-xs text-amber-400/90">
            Stale — {status.error}
          </span>
        )}
      </div>
      {/* The body flexes to fill the fixed-height bento tile and scrolls inside
          it, so a long list (torrents, containers, pools) can never blow out
          the mosaic. Placeholders center in the same space. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {showData ? (
          children
        ) : state === "unreachable" ? (
          <OfflineBody title={title} error={status.error} />
        ) : state === "disabled" ? (
          <DisabledBody />
        ) : (
          <ConnectBody title={title} />
        )}
      </div>
    </section>
  );
}

// "1.2 MB/s" — rides the system-stats byte formatting so figures match.
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

// Compact remaining time: "1h 20m", "12m", "45s".
export function formatEta(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds)}s`;
}

// The thin accent progress bar, shared with the home grid's widgets — one
// definition (SystemStatsWidget's), re-exported for the monitor cards.
export { Meter } from "@/components/widgets/SystemStatsWidget";
