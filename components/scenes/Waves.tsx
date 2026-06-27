import type { SceneProps } from "./index";

// A wave path with period 720 across a 1440 viewBox, so a layer twice the
// viewport width can translateX(-50%) and loop seamlessly (animate-wave).
const WAVE =
  "M0,80 C90,40 270,40 360,80 C450,120 630,120 720,80 C810,40 990,40 1080,80 C1170,120 1350,120 1440,80 V160 H0 Z";

// Waves — layered sine waves along the base of the page, tinted by the accent
// and sliding at different speeds for parallax. Soft pastel waves on light,
// luminous on dark. Motion stops under prefers-reduced-motion.
export default function Waves({ light }: SceneProps) {
  const k = light ? 1.4 : 1;
  const layers = [
    { color: "var(--scene-from)", pct: 12 * k, h: 220, dur: "26s", bottom: 0 },
    { color: "var(--scene-to)", pct: 16 * k, h: 180, dur: "19s", bottom: 0 },
    { color: "var(--scene-from)", pct: 22 * k, h: 130, dur: "13s", bottom: 0 },
  ];
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {layers.map((l, i) => (
        <svg
          key={i}
          className="animate-wave absolute bottom-0 left-0 w-[200%]"
          style={{
            height: l.h,
            animationDuration: l.dur,
            fill: `color-mix(in srgb, ${l.color} ${l.pct}%, transparent)`,
          }}
          viewBox="0 0 1440 160"
          preserveAspectRatio="none"
        >
          <path d={WAVE} />
        </svg>
      ))}
    </div>
  );
}
