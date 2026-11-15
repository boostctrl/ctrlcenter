"use client";

import { useState } from "react";
import type { TruenasApp, TruenasPool, TruenasSnapshot } from "@/lib/services/truenas";
import { formatBytes } from "@/components/widgets/SystemStatsWidget";
import { Dot, EmptyRow, Glyph, GlyphBubble, List, Notices, Pill, Row, Section, Stat, StatGrid, UsageBar, type Tone } from "../kit";

// TrueNAS's page (#515), on the page kit (#508): its alerts, each pool's
// health and how full it is, and the apps on its Docker engine (SCALE
// 24.10+) with the containers each runs. Read-only by design: TrueNAS write
// actions are out of scope.

// How full a pool is, as a tone: past 90% it's urgent, past 80% (where
// TrueNAS itself starts warning) it needs a look.
const fullness = (ratio: number): Tone | undefined => (ratio >= 0.9 ? "down" : ratio >= 0.8 ? "warn" : undefined);

const APP_STATE: Record<string, { tone: Tone; label: string }> = {
  RUNNING: { tone: "up", label: "Running" },
  STOPPED: { tone: "muted", label: "Stopped" },
  DEPLOYING: { tone: "info", label: "Deploying" },
  CRASHED: { tone: "down", label: "Crashed" },
};
const appState = (a: TruenasApp) =>
  APP_STATE[a.state] ?? { tone: "muted" as Tone, label: a.state.charAt(0) + a.state.slice(1).toLowerCase() };

function containerTone(state: string): Tone {
  if (state === "running") return "up";
  if (state === "exited" || state === "dead" || state === "stopped") return "down";
  return "warn";
}

function PoolRow({ pool }: { pool: TruenasPool }) {
  const used = pool.usedRatio;
  return (
    <Row
      leading={<GlyphBubble name="disk" tone={pool.healthy ? "muted" : "down"} />}
      primary={pool.name}
      title={pool.name}
      secondary={
        used !== null
          ? `${Math.round(used * 100)}% used${pool.free !== null ? ` · ${formatBytes(pool.free)} free` : ""}`
          : "Size not reported"
      }
      trailing={<Pill tone={pool.healthy ? "up" : "down"}>{pool.status.charAt(0) + pool.status.slice(1).toLowerCase()}</Pill>}
      below={used !== null ? <UsageBar ratio={used} tone={fullness(used)} /> : undefined}
    />
  );
}

function AppRow({ app }: { app: TruenasApp }) {
  const [open, setOpen] = useState(false);
  const state = appState(app);
  const count = app.containers ?? app.containerList.length;
  const head = (
    <>
      <GlyphBubble name="box" tone={state.tone === "up" ? "muted" : state.tone} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink-85" title={app.name}>
          {app.name}
        </p>
        <p className="truncate text-xs text-ink-50">
          {count} container{count === 1 ? "" : "s"}
          {app.containerList.length > 0 && ` · ${app.containerList.map((c) => c.name).join(", ")}`}
        </p>
      </div>
      <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
        {app.upgradeAvailable && <Pill tone="info">Update</Pill>}
        <Pill tone={state.tone}>{state.label}</Pill>
      </span>
    </>
  );
  if (app.containerList.length === 0) {
    return <li className="flex items-center gap-3 px-5 py-3">{head}</li>;
  }
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-fg/[0.03]"
      >
        {head}
        <span className={`shrink-0 text-ink-45 transition-transform ${open ? "rotate-90" : ""}`}>
          <Glyph name="chevron" />
        </span>
      </button>
      {open && (
        <ul className="divide-y divide-fg/[0.07] border-t border-fg/[0.07] bg-fg/[0.02]">
          {app.containerList.map((c, i) => (
            <li key={`${c.name}-${i}`} className="flex items-center gap-3 py-2.5 pr-5 pl-[4.25rem]">
              <Dot tone={containerTone(c.state)} />
              <span className="min-w-0 flex-1 truncate text-sm text-ink-80">{c.name}</span>
              {c.image && <span className="min-w-0 truncate font-mono text-xs text-ink-50">{c.image}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function TruenasDetail({ data }: { data: TruenasSnapshot }) {
  const unhealthy = data.pools.filter((p) => !p.healthy).length;
  const free = data.pools.reduce((sum, p) => sum + (p.free ?? 0), 0);
  const fullest = data.pools.reduce<TruenasPool | null>(
    (top, p) => (p.usedRatio !== null && (top === null || p.usedRatio > (top.usedRatio ?? 0)) ? p : top),
    null
  );
  const running = data.apps.filter((a) => a.running).length;
  const crashed = data.apps.filter((a) => a.state === "CRASHED").length;
  const updates = data.apps.filter((a) => a.upgradeAvailable).length;
  const critical = data.alerts.filter((a) => a.level === "critical").length;
  const alerts = [...data.alerts].sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));
  // Problem apps first, then by name.
  const apps = [...data.apps].sort(
    (a, b) => Number(a.running) - Number(b.running) || a.name.localeCompare(b.name)
  );

  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <Stat
          label="Pools"
          value={data.pools.length}
          tone={unhealthy ? "down" : undefined}
          hint={unhealthy ? `${unhealthy} not healthy` : "All healthy"}
        />
        <Stat
          label="Free space"
          value={formatBytes(free)}
          hint={fullest?.usedRatio != null ? `Fullest: ${fullest.name}, ${Math.round(fullest.usedRatio * 100)}% used` : undefined}
          visual={fullest?.usedRatio != null ? <UsageBar ratio={fullest.usedRatio} tone={fullness(fullest.usedRatio)} /> : undefined}
        />
        <Stat
          label="Apps running"
          value={running}
          unit={`of ${data.apps.length}`}
          tone={crashed ? "down" : undefined}
          hint={[crashed ? `${crashed} crashed` : null, updates ? `${updates} with updates` : null].filter(Boolean).join(" · ") || "All up to date"}
        />
        <Stat
          label="Alerts"
          value={data.alerts.length}
          tone={critical ? "down" : data.alerts.length ? "warn" : undefined}
          hint={data.alerts.length ? (critical ? `${critical} critical` : "Warnings only") : "None active"}
        />
      </StatGrid>

      {alerts.length > 0 && (
        <Section title="Alerts" count={alerts.length} flush>
          <Notices
            items={alerts.map((a) => ({
              tone: a.level === "critical" ? "down" : "warn",
              label: a.level === "critical" ? "Critical" : "Warning",
              message: a.message,
            }))}
          />
        </Section>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section title="Pools" count={data.pools.length} flush>
          {data.pools.length > 0 ? (
            <List>
              {data.pools.map((p, i) => (
                <PoolRow key={`${p.name}-${i}`} pool={p} />
              ))}
            </List>
          ) : (
            <EmptyRow>No pools.</EmptyRow>
          )}
        </Section>

        <Section title="Apps" count={data.apps.length} flush>
          {apps.length > 0 ? (
            <ul className="divide-y divide-fg/[0.07]">
              {apps.map((a, i) => (
                <AppRow key={`${a.name}-${i}`} app={a} />
              ))}
            </ul>
          ) : (
            <EmptyRow>No apps installed.</EmptyRow>
          )}
        </Section>
      </div>
    </div>
  );
}
