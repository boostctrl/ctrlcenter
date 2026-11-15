"use client";

import type { AdguardSnapshot } from "@/lib/services/adguard";
import { Donut, EmptyRow, List, Pill, Row, Section, Sparkline, Stat, StatGrid, UsageBar, formatCount } from "../kit";

// AdGuard Home's page (#516), on the page kit (#508): the query totals and
// how many were blocked, a trend of both across the stats window (drawn from
// the per-unit series AdGuard already returns, so it costs no extra
// request), and the domains it blocks most.

const W = 320;
const H = 96;

// Build the SVG path for a series: an area (closed to the baseline) or a line.
function seriesPath(values: number[], max: number, area: boolean): string {
  const n = values.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0);
  const y = (v: number) => H - (max > 0 ? (v / max) * (H - 6) : 0);
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  if (!area) return `M${line.join(" L")}`;
  return `M0,${H} L${line.join(" L")} L${W},${H} Z`;
}

function TrendChart({
  series,
  blockedSeries,
  windowLabel,
}: {
  series: number[];
  blockedSeries: number[];
  windowLabel: string | null;
}) {
  if (series.length < 2) {
    return <p className="text-sm text-ink-50">Not enough data yet for a trend.</p>;
  }
  const max = Math.max(...series, 1);
  const peak = Math.max(...series);
  const hasBlocked = blockedSeries.length === series.length;
  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden
        className="h-32 w-full"
      >
        <defs>
          <linearGradient id="adguard-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-from)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent-from)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={seriesPath(series, max, true)} fill="url(#adguard-fill)" />
        <path
          d={seriesPath(series, max, false)}
          fill="none"
          stroke="var(--accent-from)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {hasBlocked && (
          <path
            d={seriesPath(blockedSeries, max, false)}
            fill="none"
            className="text-status-down"
            stroke="currentColor"
            strokeOpacity="0.7"
            strokeWidth="1.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-ink-45">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--accent-from)]" />
            queries
          </span>
          {hasBlocked && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-status-down/70" />
              blocked
            </span>
          )}
        </span>
        <span className="tabular-nums">
          peak {formatCount(peak)}
          {windowLabel && <> · {windowLabel}</>}
        </span>
      </div>
    </div>
  );
}

export default function AdguardDetail({ data }: { data: AdguardSnapshot }) {
  const pct = Math.round(data.blockedRatio * 1000) / 10;
  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <Stat
          label="Queries"
          value={formatCount(data.totalQueries)}
          hint={data.windowLabel ?? undefined}
          visual={data.series.length > 1 ? <Sparkline data={data.series} area className="h-6 w-full" /> : undefined}
        />
        <Stat
          label="Blocked"
          value={formatCount(data.blocked)}
          hint={`${pct}% of queries`}
          visual={<UsageBar ratio={data.blockedRatio} />}
        />
        <Stat
          label="Average lookup"
          value={data.avgProcessingMs !== null ? data.avgProcessingMs.toFixed(1) : "—"}
          unit={data.avgProcessingMs !== null ? "ms" : undefined}
          hint="Time to answer a query"
        />
        <Stat
          label="Protection"
          value={data.protectionEnabled ? "On" : "Off"}
          tone={data.protectionEnabled ? "up" : "warn"}
          hint={data.protectionEnabled ? "Filtering every query" : "Nothing is being blocked"}
        />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Queries over time" description={data.windowLabel ? `The ${data.windowLabel}.` : undefined}>
          <TrendChart series={data.series} blockedSeries={data.blockedSeries} windowLabel={null} />
        </Section>
        <Section
          title="What happened to them"
          description={
            data.filters
              ? `${data.filters.lists} filter list${data.filters.lists === 1 ? "" : "s"} · ${formatCount(data.filters.rules)} rules`
              : undefined
          }
        >
          <Donut
            label="Queries by outcome"
            center={formatCount(data.totalQueries)}
            caption="queries"
            parts={[
              { label: "Allowed", value: Math.max(0, data.totalQueries - data.blocked - data.safeBrowsing - data.parental), color: 3 as const },
              { label: "Blocked by filters", value: data.blocked, color: "down" as const },
              { label: "Safe Browsing", value: data.safeBrowsing, color: 4 as const },
              { label: "Parental control", value: data.parental, color: 5 as const },
            ]
              .filter((p, i) => i < 2 || p.value > 0)
              .map((p) => ({ ...p, display: formatCount(p.value) }))}
          />
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Ranked title="Most blocked" items={data.topBlocked.map((d) => ({ name: d.domain, count: d.count }))} tone="down" empty="Nothing blocked in this window." />
        <Ranked title="Most queried" items={data.topQueried.map((d) => ({ name: d.domain, count: d.count }))} empty="No queries in this window." />
        <Ranked title="Busiest clients" items={data.topClients} empty="No clients in this window." />
      </div>
    </div>
  );
}

// A ranked list: each name with its count and a bar against the first.
function Ranked({
  title,
  items,
  tone,
  empty,
}: {
  title: string;
  items: { name: string; count: number }[];
  tone?: "down";
  empty: string;
}) {
  const top = items[0]?.count ?? 0;
  return (
    <Section title={title} count={items.length} flush>
      {items.length > 0 ? (
        <List>
          {items.map((d, i) => (
            <Row
              key={d.name}
              leading={
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-fg/[0.06] text-sm font-semibold tabular-nums text-ink-60">
                  {i + 1}
                </span>
              }
              primary={d.name}
              title={d.name}
              trailing={<Pill>{formatCount(d.count)}</Pill>}
              below={<UsageBar ratio={top ? d.count / top : 0} tone={tone} className="h-1" />}
            />
          ))}
        </List>
      ) : (
        <EmptyRow>{empty}</EmptyRow>
      )}
    </Section>
  );
}
