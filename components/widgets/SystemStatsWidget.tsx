"use client";

import SectionTitle from "../SectionTitle";
import type { SystemStats } from "@/lib/system-stats";

// System Stats card: CPU load, memory pressure, and disk fill of whatever is
// running the app, collected server-side per render (lib/system-stats.ts) and
// passed in as a static snapshot — no client polling. The footer names what
// the CPU/memory numbers describe ("this container" vs "the host machine"),
// the expectation-setting #153's design demands: a container without host
// mounts genuinely cannot see the host, and the card must not imply it does.

// "3.2 GB of 16 GB" style figures. Binary units (GiB semantics) shown with the
// everyday labels, one decimal under 10.
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let u = 0;
  while (value >= 1024 && u < units.length - 1) {
    value /= 1024;
    u++;
  }
  const rounded = value >= 10 || u === 0 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[u]}`;
}

function Meter({ percent }: { percent: number }) {
  const pct = Math.min(100, Math.max(0, percent));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-fg/10">
      {/* Width is a runtime value, so it stays an inline style (the same
          pattern as the weather range bars); the gradient rides the theme's
          accent variables like CalendarMonth's accent fills. */}
      <div
        className="h-full rounded-full bg-gradient-to-r from-[var(--accent-from)] to-[var(--accent-to)]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StatRow({
  label,
  detail,
  percent,
}: {
  label: string;
  detail: string;
  percent: number;
}) {
  return (
    <li className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
      {/* Wrap, never truncate: on a narrow card the figure moves to its own
          line under the label instead of eating it ("Memory" must not become
          "Me…" — the #145 rule). */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="break-words text-sm text-fg/80">{label}</span>
        <span className="shrink-0 text-sm tabular-nums text-fg/60">{detail}</span>
      </div>
      <Meter percent={percent} />
    </li>
  );
}

export default function SystemStatsWidget({
  title,
  stats,
  showTitle = true,
}: {
  title: string;
  stats: SystemStats;
  // Show the section heading; the layout editor's label toggle turns it off.
  showTitle?: boolean;
}) {
  const rows: { label: string; detail: string; percent: number }[] = [];
  if (stats.cpu) {
    rows.push({
      label: "CPU",
      detail: `${stats.cpu.percent.toFixed(0)}%`,
      percent: stats.cpu.percent,
    });
  }
  if (stats.memory && stats.memory.totalBytes > 0) {
    const pct = (stats.memory.usedBytes / stats.memory.totalBytes) * 100;
    rows.push({
      label: "Memory",
      detail: `${formatBytes(stats.memory.usedBytes)} of ${formatBytes(stats.memory.totalBytes)}`,
      percent: pct,
    });
  }
  for (const disk of stats.disks) {
    if (disk.totalBytes <= 0) continue;
    rows.push({
      label: disk.label,
      detail: `${formatBytes(disk.usedBytes)} of ${formatBytes(disk.totalBytes)}`,
      percent: (disk.usedBytes / disk.totalBytes) * 100,
    });
  }
  if (rows.length === 0) return null;

  return (
    <section>
      {showTitle && title.trim() !== "" && <SectionTitle>{title}</SectionTitle>}
      <div className="glass-card p-6">
        <ul className="divide-y divide-fg/10">
          {rows.map((row, i) => (
            <StatRow key={`${row.label}-${i}`} {...row} />
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-fg/35">
          {stats.source === "container"
            ? "Measuring this container's resources"
            : "Measuring the host machine"}
        </p>
      </div>
    </section>
  );
}
