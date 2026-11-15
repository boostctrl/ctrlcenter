"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { MonitorEntry, MonitorSnapshot } from "@/lib/monitor";
import { serviceState, STATE_DOT, type ServiceState } from "./state";
import { Glyph, TONE_SOFT, TONE_TEXT } from "./kit";

// The cockpit's master status bar (#208): the at-a-glance system-health read
// that sits above the bento so the whole homelab resolves to a single line
// before the eye reaches any one tile. Everything here is derived from the same
// snapshot the tiles render, using the same serviceState/dot vocabulary — so a
// dot in the bar means exactly what a dot on a tile means.

function Chip({
  dot,
  children,
}: {
  // A STATE_DOT class for a leading pip, or omitted for a plain stat chip.
  dot?: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-fg/10 bg-fg/5 px-3 py-1 text-xs text-ink-70">
      {dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {children}
    </span>
  );
}

export default function SystemHealthBar({
  snapshot,
}: {
  snapshot: MonitorSnapshot;
}) {
  const states = snapshot.map((e) => serviceState(e));
  const n = (s: ServiceState) => states.filter((x) => x === s).length;
  const live = n("live");
  const stale = n("stale");
  const offline = n("unreachable");
  const disabled = n("disabled");
  const connected = live + stale + offline;

  // Cross-service highlights — best effort, summed over every integration of
  // the type (#300). Read whenever a snapshot is present (live or
  // last-good/stale); a missing one simply adds nothing.
  const ofType = <K extends MonitorEntry["type"]>(type: K) =>
    snapshot.filter((e): e is Extract<MonitorEntry, { type: K }> => e.type === type);
  const downloading = ofType("qbittorrent").reduce((n, e) => n + (e.data?.counts.downloading ?? 0), 0);
  const streams = ofType("tautulli").reduce((n, e) => n + (e.data?.streamCount ?? 0), 0);
  const alerts = ofType("truenas").flatMap((e) => e.data?.alerts ?? []);
  const criticalAlerts = alerts.some((a) => a.level === "critical");

  const attention = offline > 0 || criticalAlerts;

  // The one-line verdict, in priority order.
  const overall = attention
    ? { dot: STATE_DOT.unreachable, text: "Attention needed" }
    : stale > 0
      ? { dot: STATE_DOT.stale, text: "Running degraded" }
      : connected > 0
        ? { dot: STATE_DOT.live, text: "All systems normal" }
        : { dot: STATE_DOT.disabled, text: "No integrations connected" };

  // What's wrong, each linking to the page that shows it: the TrueNAS
  // alerts, then any integration that can't be reached (#509).
  const page = (id: string) => `/admin/monitor/${encodeURIComponent(id)}`;
  const problems: { tone: "down" | "warn"; message: string; source: string; href: string }[] = [
    ...ofType("truenas").flatMap((e) =>
      (e.data?.alerts ?? []).map((a) => ({
        tone: a.level === "critical" ? ("down" as const) : ("warn" as const),
        message: a.message,
        source: e.label,
        href: page(e.id),
      }))
    ),
    ...snapshot
      .filter((e) => serviceState(e) === "unreachable")
      .map((e) => ({ tone: "down" as const, message: e.error ? `Can't reach it: ${e.error}` : "Can't reach it", source: e.label, href: page(e.id) })),
  ];
  const showProblems = (attention || stale > 0) && problems.length > 0;
  const PROBLEM_CAP = 5;
  const summary = attention
    ? [offline ? `${offline} offline` : null, alerts.length ? `${alerts.length} alert${alerts.length === 1 ? "" : "s"}` : null]
        .filter(Boolean)
        .join(" · ")
    : connected === 0
      ? "Connect a service in Settings to get started."
      : `${connected} of ${snapshot.length} integrations connected`;

  return (
    <section aria-label="System health" className="glass-card flex flex-col [--surface-lift:0px]">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              attention ? TONE_SOFT.down : stale > 0 ? TONE_SOFT.warn : connected > 0 ? TONE_SOFT.up : TONE_SOFT.muted
            }`}
          >
            <Glyph name={attention ? "alert" : stale > 0 ? "pulse" : connected > 0 ? "check" : "info"} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink-90">{overall.text}</h2>
            <p className="truncate text-xs text-ink-55">{summary}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {live > 0 && <Chip dot={STATE_DOT.live}>{live} live</Chip>}
          {stale > 0 && <Chip dot={STATE_DOT.stale}>{stale} stale</Chip>}
          {offline > 0 && <Chip dot={STATE_DOT.unreachable}>{offline} offline</Chip>}
          {disabled > 0 && <Chip dot={STATE_DOT.disabled}>{disabled} off</Chip>}
          {/* A thin divider before the activity highlights, when there are any. */}
          {(downloading > 0 || streams > 0) && <span aria-hidden className="mx-1 h-4 w-px bg-fg/10" />}
          {downloading > 0 && <Chip>{downloading} downloading</Chip>}
          {streams > 0 && (
            <Chip>
              {streams} stream{streams === 1 ? "" : "s"}
            </Chip>
          )}
        </div>
      </div>

      {showProblems && (
        <ul className="divide-y divide-fg/[0.07] border-t border-fg/[0.07]">
          {problems.slice(0, PROBLEM_CAP).map((p, i) => (
            <li key={`${p.href}-${i}`}>
              <Link
                href={p.href}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-fg/[0.03]"
              >
                <span className={`shrink-0 ${TONE_TEXT[p.tone]}`}>
                  <Glyph name={p.tone === "down" ? "error" : "alert"} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-sm text-ink-85" title={p.message}>
                    {p.message}
                  </span>
                  <span className="block text-xs text-ink-50">{p.source}</span>
                </span>
                <span className="shrink-0 text-ink-40">
                  <Glyph name="chevron" />
                </span>
              </Link>
            </li>
          ))}
          {problems.length > PROBLEM_CAP && (
            <li className="px-5 py-2.5 text-xs text-ink-50">and {problems.length - PROBLEM_CAP} more</li>
          )}
        </ul>
      )}
    </section>
  );
}
