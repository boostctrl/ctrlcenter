import type { SceneProps } from "./index";

// Horizon — a retro sun sinking to a glowing horizon line: a large accent
// gradient disc with scanline slits cut from its lower half, a hairline horizon
// across the page, a sky wash above and ground haze below. Recolors from the
// scene vars; calmer on light surfaces. The halo behind the disc breathes; that
// stops under prefers-reduced-motion (.animate-breathe in globals.css) and the
// rest is static.
export default function Horizon({ light }: SceneProps) {
  const disc = light ? 0.8 : 0.95;
  const sky = light ? 0.16 : 0.22;
  const haze = light ? 0.14 : 0.18;
  const line = light ? 0.55 : 0.7;
  const mix = (c: string, op: number) =>
    `color-mix(in srgb, ${c} ${op * 100}%, transparent)`;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "var(--glow-opacity, 1)" }}
    >
      {/* Sky wash rising from the horizon. */}
      <div
        className="absolute inset-x-0 top-0 h-[62%]"
        style={{
          background: `linear-gradient(to top, ${mix("var(--scene-from)", sky)}, transparent 75%)`,
        }}
      />
      {/* Breathing halo behind the sun (translate comes from the animation). */}
      <div
        className="animate-breathe absolute top-[46%] left-1/2 h-[60vmin] w-[60vmin] rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle, ${mix("var(--scene-from)", light ? 0.35 : 0.45)}, transparent 70%)`,
        }}
      />
      {/* The sun: a gradient disc, solid on top, sliced into scanlines below
          (two mask layers union — top half + stripes). */}
      <div
        className="absolute top-[62%] left-1/2 h-[44vmin] w-[44vmin] -translate-x-1/2 -translate-y-[86%] rounded-full"
        style={{
          backgroundImage: `linear-gradient(to bottom, ${mix("var(--scene-from)", disc)}, ${mix("var(--scene-to)", disc * 0.85)})`,
          WebkitMaskImage:
            "linear-gradient(#000 0 52%, transparent 52%), repeating-linear-gradient(to bottom, #000 0 9px, transparent 9px 15px)",
          maskImage:
            "linear-gradient(#000 0 52%, transparent 52%), repeating-linear-gradient(to bottom, #000 0 9px, transparent 9px 15px)",
        }}
      />
      {/* The horizon itself: a bright hairline with a soft under-glow. */}
      <div
        className="absolute inset-x-0 top-[62%] h-px"
        style={{
          background: `linear-gradient(to right, transparent, ${mix("var(--scene-from)", line)} 25%, ${mix("var(--scene-to)", line)} 75%, transparent)`,
        }}
      />
      <div
        className="absolute inset-x-0 top-[62%] h-[38%]"
        style={{
          background: `linear-gradient(to bottom, ${mix("var(--scene-to)", haze)}, transparent 55%)`,
        }}
      />
    </div>
  );
}
