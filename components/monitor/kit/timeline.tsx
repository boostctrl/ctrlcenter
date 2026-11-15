"use client";

// Charts over time (#530): a line chart of the readings CtrlCenter recorded,
// and the panel that fetches them for an integration's page with a choice of
// the last hour or the last day. The chart answers a hover or the arrow keys
// with every series' value at that moment, and says what it shows to a
// screen reader.
import { useCallback, useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { History, HistoryRange } from "@/lib/monitor-history";
import { usePolling } from "@/components/usePolling";
import { useMonitorIntegration } from "../actions";
import { chartColor, type ChartColor } from "./charts";
import { Section } from "./layout";

export type TimeSeries = { label: string; color: ChartColor; values: (number | null)[] };

const W = 600;
const H = 160;

const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// A round top for the scale: 1, 2 or 5 times a power of ten, in the units
// shown, so a byte rate's scale reads 10 MB/s, not 9.5 (its units step by
// 1024).
function niceMax(v: number, binary = false): number {
  if (v <= 0) return 1;
  const unit = binary ? 1024 ** Math.max(0, Math.floor(Math.log(v) / Math.log(1024))) : 1;
  const m = v / unit;
  const p = 10 ** Math.floor(Math.log10(m));
  return ([1, 2, 5, 10].find((k) => k * p >= m) ?? 10) * p * unit;
}

// The line through a series, broken where nothing was recorded.
function linePath(values: (number | null)[], max: number): string {
  const step = values.length > 1 ? W / (values.length - 1) : W;
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const x = (i * step).toFixed(1);
    const y = (H - (v / max) * H).toFixed(1);
    d += `${pen ? "L" : "M"}${x},${y}`;
    pen = true;
  });
  return d;
}

// The area under the first series, a run at a time.
function areaPath(values: (number | null)[], max: number): string {
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const runs: [number, number][] = [];
  let start = -1;
  values.forEach((v, i) => {
    if (v !== null && start < 0) start = i;
    if ((v === null || i === values.length - 1) && start >= 0) {
      runs.push([start, v === null ? i - 1 : i]);
      start = -1;
    }
  });
  return runs
    .map(([a, b]) => {
      const pts = values.slice(a, b + 1).map((v, k) => `${((a + k) * step).toFixed(1)},${(H - ((v ?? 0) / max) * H).toFixed(1)}`);
      return `M${(a * step).toFixed(1)},${H}L${pts.join("L")}L${(b * step).toFixed(1)},${H}Z`;
    })
    .join("");
}

export function LineChart({
  at,
  series,
  format,
  label,
  binary = false,
}: {
  at: number[];
  series: TimeSeries[];
  format: (v: number) => string;
  // The values are bytes, shown in 1024 steps.
  binary?: boolean;
  // What the chart shows, for a screen reader.
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = niceMax(Math.max(...all, 0), binary);
  const points = Math.max(...series.map((s) => s.values.filter((v) => v !== null).length), 0);
  const latest = (s: TimeSeries) => [...s.values].reverse().find((v) => v !== null) ?? null;
  const peak = (s: TimeSeries) => Math.max(...s.values.filter((v): v is number => v !== null), 0);
  const summary = series
    .map((s) => (latest(s) === null ? `${s.label}: no readings` : `${s.label} now ${format(latest(s)!)}, peak ${format(peak(s))}`))
    .join("; ");

  const pick = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      const i = Math.round(((e.clientX - box.left) / box.width) * (at.length - 1));
      setHover(Math.min(at.length - 1, Math.max(0, i)));
    },
    [at.length]
  );
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const last = at.length - 1;
    setHover((h) => {
      const cur = h ?? last;
      if (e.key === "Home") return 0;
      if (e.key === "End") return last;
      return Math.min(last, Math.max(0, cur + (e.key === "ArrowRight" ? 1 : -1)));
    });
  };

  if (points < 2) {
    return (
      <p className="flex h-40 items-center justify-center px-6 text-center text-sm text-ink-50">
        Collecting readings. The chart fills in as CtrlCenter records one a minute.
      </p>
    );
  }
  const left = hover === null ? 0 : (hover / Math.max(1, at.length - 1)) * 100;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        {/* The scale: the top and the middle, over a zero baseline. */}
        <div aria-hidden className="flex h-40 w-12 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-ink-45">
          <span>{format(max)}</span>
          <span>{format(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative h-40 min-w-0 flex-1">
          <div
            role="img"
            aria-label={`${label}: ${summary}`}
            aria-describedby={hover !== null ? `${id}-tip` : undefined}
            tabIndex={0}
            onPointerMove={pick}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
            className="absolute inset-0 cursor-crosshair rounded-sm"
          >
            <svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
              {[0, 0.5, 1].map((f) => (
                <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" className="text-fg/10" />
              ))}
              <path d={areaPath(series[0].values, max)} fill={chartColor(series[0].color)} opacity="0.12" />
              {series.map((s) => (
                <path
                  key={s.label}
                  d={linePath(s.values, max)}
                  fill="none"
                  stroke={chartColor(s.color)}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </div>
          {/* Beside the image, not in it, so the tooltip is read out as the
              arrow keys move it. */}
          {hover !== null && (
            <>
              <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-fg/30" style={{ left: `${left}%` }} />
              {series.map((s) => {
                const v = s.values[hover];
                return v === null ? null : (
                  <span
                    key={s.label}
                    aria-hidden
                    className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-[var(--background)]"
                    style={{ left: `${left}%`, bottom: `${(v / max) * 100}%`, background: chartColor(s.color) }}
                  />
                );
              })}
              <div
                id={`${id}-tip`}
                role="status"
                className={`pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-fg/10 bg-[var(--background)] px-3 py-2 text-xs shadow-lg ${
                  left > 60 ? "-translate-x-[calc(100%+10px)]" : "translate-x-2.5"
                }`}
                style={{ left: `${left}%` }}
              >
                <p className="mb-1 font-medium text-ink-70">{clock(at[hover])}</p>
                {series.map((s) => (
                  <p key={s.label} className="flex items-center gap-2 text-ink-60">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: chartColor(s.color) }} />
                    <span className="flex-1">{s.label}</span>
                    <span className="font-medium tabular-nums text-ink-90">{s.values[hover] === null ? "–" : format(s.values[hover]!)}</span>
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 pl-[3.75rem] text-[11px] text-ink-45">
        <span>{clock(at[0])}</span>
        <span>{clock(at[Math.floor(at.length / 2)])}</span>
        <span>Now</span>
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 pl-[3.75rem] text-xs text-ink-60">
        {series.map((s) => (
          <li key={s.label} className="inline-flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: chartColor(s.color) }} />
            {s.label}
            {latest(s) !== null && <span className="font-medium tabular-nums text-ink-85">{format(latest(s)!)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export type HistoryChart = {
  title: string;
  metrics: { key: string; label: string; color: ChartColor }[];
  format: (v: number) => string;
  binary?: boolean;
};

// An integration's recorded history as one or more charts, for the last
// hour or the last day, refreshed each minute while the page is open.
export function HistoryCharts({ charts, title = "Over time" }: { charts: HistoryChart[]; title?: string }) {
  const integration = useMonitorIntegration();
  const [range, setRange] = useState<HistoryRange>("hour");
  const [history, setHistory] = useState<History | null>(null);
  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const res = await fetch(`/api/monitor/${encodeURIComponent(integration)}/history?range=${range}`, { signal });
        if (!res.ok) return;
        const next = (await res.json()) as History;
        if (!signal.aborted) setHistory(next);
      } catch {
        // The next poll tries again.
      }
    },
    [integration, range]
  );
  usePolling(load, 60_000);

  return (
    <Section
      title={title}
      description={range === "hour" ? "The last hour, a reading a minute." : "The last 24 hours, in 15-minute steps."}
      actions={
        <div role="group" aria-label="Time range" className="flex items-center gap-1 text-xs">
          {(["hour", "day"] as const).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              className={`rounded-full px-2.5 py-1 transition-colors ${
                range === r ? "bg-fg/10 font-medium text-ink-90" : "text-ink-55 hover:text-ink-85"
              }`}
            >
              {r === "hour" ? "Hour" : "24 hours"}
            </button>
          ))}
        </div>
      }
    >
      <div className={`grid gap-x-8 gap-y-6 ${charts.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {charts.map((c) => (
          <div key={c.title} className="flex min-w-0 flex-col gap-3">
            {charts.length > 1 && <h3 className="text-sm font-medium text-ink-70">{c.title}</h3>}
            {history && history.range === range ? (
              <LineChart
                label={c.title}
                at={history.at}
                format={c.format}
                binary={c.binary}
                series={c.metrics.map((m) => ({ label: m.label, color: m.color, values: history.series[m.key] ?? history.at.map(() => null) }))}
              />
            ) : (
              <p className="flex h-40 items-center justify-center text-sm text-ink-50">Loading…</p>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}
