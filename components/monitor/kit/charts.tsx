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
