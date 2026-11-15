// The small charts the Monitor draws (#508): a line over time, a strip of
// day bars, a bar split into parts, and a usage meter. The dashboard tiles
// and the integration pages share them; each takes its size and spacing
// from the caller. All decorative: the numbers beside them are the content.
import type { SegmentTone } from "../glances";
import { TONE_FILL, type Tone } from "./tone";

// A line through the last `points` values, scaled to the largest, with an
// optional soft fill under it.
export function Sparkline({
  data,
  className = "h-4 w-full",
  points = 32,
  area = false,
}: {
  data: number[];
  className?: string;
  points?: number;
  area?: boolean;
}) {
  const pts = data.slice(-points);
  const max = Math.max(...pts, 1);
  const w = 100;
  const h = 18;
  const step = pts.length > 1 ? w / (pts.length - 1) : w;
  const coords = pts.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
      className={`text-[var(--accent-from)] ${className}`}
    >
      {area && pts.length > 1 && (
        <polygon points={`0,${h} ${coords.join(" ")} ${w},${h}`} fill="currentColor" opacity="0.12" />
      )}
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// One bar per day, oldest first; an empty day is a short stub.
export function DayStrip({ values, className = "h-5 gap-1" }: { values: number[]; className?: string }) {
  const max = Math.max(...values, 1);
  return (
    <div aria-hidden className={`flex items-end ${className}`}>
      {values.map((v, i) => (
        <span
          key={i}
          className={`flex-1 rounded-sm ${v > 0 ? "bg-[var(--accent-from)]" : "bg-fg/15"}`}
          style={{ height: `${v > 0 ? Math.max(20, (v / max) * 100) : 12}%` }}
        />
      ))}
    </div>
  );
}

const SEGMENT_BG: Record<SegmentTone, string> = {
  pending: "bg-status-warning/80",
  processing: "bg-status-info/70",
  available: "bg-status-up/70",
};

// A bar split by share: requests pending, processing and available.
export function SegmentBar({
  parts,
  className = "h-1.5",
}: {
  parts: { value: number; tone: SegmentTone }[];
  className?: string;
}) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  return (
    <div aria-hidden className={`flex w-full overflow-hidden rounded-full bg-fg/10 ${className}`}>
      {total > 0 &&
        parts.map(
          (p, i) =>
            p.value > 0 && (
              <span key={i} className={SEGMENT_BG[p.tone]} style={{ width: `${(p.value / total) * 100}%` }} />
            )
        )}
    </div>
  );
}

// How full something is, 0–1, in a tone (the accent when none is given).
export function UsageBar({ ratio, tone, className = "h-1.5" }: { ratio: number; tone?: Tone; className?: string }) {
  const pct = Math.min(100, Math.max(0, ratio * 100));
  return (
    <div aria-hidden className={`w-full overflow-hidden rounded-full bg-fg/10 ${className}`}>
      <div
        className={`h-full rounded-full ${tone ? TONE_FILL[tone] : ""}`}
        style={{
          width: `${pct}%`,
          ...(tone ? {} : { backgroundImage: "linear-gradient(to right, var(--accent-from), var(--accent-to))" }),
        }}
      />
    </div>
  );
}

// --- The larger charts (stage E): parts of a whole and counts over time.
// Each part is named in a legend with its figure, so color is never the
// only cue, and its mark carries a tooltip. ---

// A series' color: one of the five chart hues, in the order given (the
// color follows the entry, never its rank), or a status tone for a state.
export type ChartColor = 1 | 2 | 3 | 4 | 5 | Tone;
const TONE_VAR: Record<Tone, string> = {
  up: "var(--status-up)",
  warn: "var(--status-warning)",
  down: "var(--status-down)",
  info: "var(--status-info)",
  muted: "color-mix(in srgb, var(--fg) 28%, transparent)",
};
export const chartColor = (c: ChartColor): string => (typeof c === "number" ? `var(--chart-${c})` : TONE_VAR[c]);

export type ChartPart = { label: string; value: number; color: ChartColor; display?: string };

// The legend: a swatch, the name, the figure and its share.
export function Legend({ parts, share = true }: { parts: ChartPart[]; share?: boolean }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  return (
    <ul className="flex min-w-0 flex-col gap-2 text-sm">
      {parts.map((p) => (
        <li key={p.label} className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: chartColor(p.color) }} />
          <span className="min-w-0 flex-1 truncate text-ink-70">{p.label}</span>
          <span className="shrink-0 font-medium tabular-nums text-ink-90">{p.display ?? p.value.toLocaleString()}</span>
          {share && (
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-50">
              {total > 0 ? `${Math.round((p.value / total) * 100)}%` : "–"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

// A donut: the parts of one whole around its total, beside their legend.
// Parts of nothing draw an empty ring.
export function Donut({
  parts,
  center,
  caption,
  label,
}: {
  parts: ChartPart[];
  // The figure in the middle and the word under it.
  center: string;
  caption: string;
  // What the chart shows, for a screen reader.
  label: string;
}) {
  const R = 42;
  const C = 2 * Math.PI * R;
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((sum, p) => sum + p.value, 0);
  const gap = shown.length > 1 ? 2.5 : 0;
  // Each arc starts where the ones before it end.
  const starts = shown.map((_, i) => shown.slice(0, i).reduce((sum, p) => sum + (p.value / total) * C, 0));
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
      <div
        role="img"
        aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.display ?? p.value}`).join(", ")}`}
        className="relative mx-auto h-40 w-40 shrink-0"
      >
        <svg aria-hidden viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={R} fill="none" stroke="currentColor" strokeWidth="11" className="text-fg/[0.08]" />
          {shown.map((p, i) => {
            const len = (p.value / total) * C;
            return (
              <circle
                key={p.label}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={chartColor(p.color)}
                strokeWidth="11"
                strokeDasharray={`${Math.max(0.5, len - gap).toFixed(2)} ${(C - Math.max(0.5, len - gap)).toFixed(2)}`}
                strokeDashoffset={(-starts[i] - gap / 2).toFixed(2)}
              >
                <title>{`${p.label}: ${p.display ?? p.value.toLocaleString()}`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="text-2xl font-bold tracking-tight tabular-nums text-ink-90">{center}</span>
          <span className="mt-1.5 text-[10px] font-semibold tracking-[0.14em] text-ink-50 uppercase">{caption}</span>
        </div>
      </div>
      <div className="min-w-[11rem] flex-1">
        <Legend parts={parts} />
      </div>
    </div>
  );
}

// Bars over time: one column per slot (a day, an hour), each stacked from
// its series, over quiet slot labels. The tallest column sets the scale.
export function BarChart({
  slots,
  series,
  label,
  className = "h-44",
}: {
  slots: { label: string; values: number[] }[];
  series: { label: string; color: ChartColor }[];
  label: string;
  className?: string;
}) {
  const totals = slots.map((s) => s.values.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 1);
  const sums = series.map((_, i) => slots.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  return (
    <div className="flex flex-col gap-4">
      <div
        role="img"
        aria-label={`${label}: ${series.map((s, i) => `${sums[i]} ${s.label}`).join(", ")}`}
        className={`flex items-stretch gap-2 ${className}`}
      >
        {slots.map((slot, i) => (
          <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className="text-[11px] tabular-nums text-ink-50">{totals[i] > 0 ? totals[i] : ""}</span>
            <div
              className="flex w-full max-w-14 flex-1 flex-col-reverse gap-0.5 border-b border-fg/15"
              title={`${slot.label}: ${series.map((s, k) => `${slot.values[k] ?? 0} ${s.label}`).join(", ")}`}
            >
              {series.map(
                (s, k) =>
                  (slot.values[k] ?? 0) > 0 && (
                    <span
                      key={s.label}
                      className={k === series.length - 1 || !slot.values.slice(k + 1).some((v) => v > 0) ? "rounded-t-[4px]" : ""}
                      style={{ height: `${((slot.values[k] ?? 0) / max) * 100}%`, background: chartColor(s.color) }}
                    />
                  )
              )}
            </div>
            <span className="truncate text-[11px] text-ink-50">{slot.label}</span>
          </div>
        ))}
      </div>
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-60">
          {series.map((s, i) => (
            <li key={s.label} className="inline-flex items-center gap-2">
              <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: chartColor(s.color) }} />
              {s.label}
              <span className="font-medium tabular-nums text-ink-85">{sums[i]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
