import type { SceneProps } from "./index";

// Blueprint — a flat sheet of drafting paper: a fine grid with bolder major
// lines, plus a few construction marks (a dashed circle with crosshairs and a
// dashed setting-out rectangle) as the signature ornament. Deliberately flat
// and technical — the perspective Grid scene's drawing-board sibling. Fully
// static, so nothing to quiet under prefers-reduced-motion. Recolors from the
// scene vars; a touch stronger on light so hairlines survive the pale surface.
export default function Blueprint({ light }: SceneProps) {
  const minor = light ? 0.1 : 0.08;
  const major = light ? 0.18 : 0.15;
  const marks = light ? 0.4 : 0.32;
  const mix = (c: string, op: number) =>
    `color-mix(in srgb, ${c} ${op * 100}%, transparent)`;
  const line = (angle: string, color: string, gap: number) =>
    `repeating-linear-gradient(${angle}, ${color} 0 1px, transparent 1px ${gap}px)`;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "var(--glow-opacity, 1)" }}
    >
      {/* The sheet: fine grid + major lines, faded toward the edges. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
            line("90deg", mix("var(--scene-from)", minor), 24),
            line("0deg", mix("var(--scene-from)", minor), 24),
            line("90deg", mix("var(--scene-from)", major), 120),
            line("0deg", mix("var(--scene-from)", major), 120),
          ].join(", "),
          WebkitMaskImage:
            "radial-gradient(120% 100% at 50% 40%, #000 40%, transparent 95%)",
          maskImage:
            "radial-gradient(120% 100% at 50% 40%, #000 40%, transparent 95%)",
        }}
      />
      {/* Construction marks: a dashed circle + crosshairs, top right. */}
      <div
        className="absolute top-[16%] left-[74%] h-[34vmin] w-[34vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed"
        style={{ borderColor: mix("var(--scene-to)", marks) }}
      />
      <div
        className="absolute top-[16%] left-[74%] h-[46vmin] w-px -translate-x-1/2 -translate-y-1/2"
        style={{ background: mix("var(--scene-to)", marks * 0.7) }}
      />
      <div
        className="absolute top-[16%] left-[74%] h-px w-[46vmin] -translate-x-1/2 -translate-y-1/2"
        style={{ background: mix("var(--scene-to)", marks * 0.7) }}
      />
      {/* A dashed setting-out rectangle, lower left. */}
      <div
        className="absolute bottom-[10%] left-[8%] h-[22vmin] w-[34vmin] border border-dashed"
        style={{ borderColor: mix("var(--scene-from)", marks * 0.8) }}
      />
    </div>
  );
}
