import type { SceneProps } from "./index";

// How far beam-sweep (app/globals.css) carries the layer each cycle, in px.
// The bar pattern repeats along its 115° gradient line every SWEEP·sin(115°)
// px, which is exactly the horizontal shift that maps it onto itself — so the
// layer, overhanging the left edge by SWEEP, loops with no seam.
const SWEEP = 1200;
const ANGLE = 115;
const PERIOD = SWEEP * Math.sin((ANGLE * Math.PI) / 180);

// Beams — broad diagonal bars of accent light sweeping slowly across the page,
// like sun through a tall window: a wide bar in the first accent and a
// narrower, fainter one in the second per period, soft-shouldered so they read
// as light rather than stripes, strongest at the top and thinning toward the
// floor. One repeating-linear-gradient layer translated by a composited
// transform (no per-frame repaint, no blur). Glow-gated like Rays, so a design
// with no glow (Flat) shows none of it. The sweep stops under
// prefers-reduced-motion and the Still level (see .animate-beams).
export default function Beams({ light }: SceneProps) {
  const hi = light ? 0.34 : 0.26;
  const lo = light ? 0.22 : 0.16;
  const mix = (c: string, op: number) =>
    `color-mix(in srgb, ${c} ${op * 100}%, transparent)`;
  const bars = [
    `transparent 0`,
    `${mix("var(--scene-from)", hi)} 90px 300px`,
    `transparent 390px 600px`,
    `${mix("var(--scene-to)", lo)} 650px 800px`,
    `transparent 850px ${PERIOD}px`,
  ].join(", ");
  return (
    <div
      aria-hidden
      className="scene-root pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "calc(var(--glow-opacity, 1) * var(--scene-opacity, 1))" }}
    >
      <div
        className="animate-beams absolute inset-y-0 right-0"
        style={{
          left: -SWEEP,
          backgroundImage: `repeating-linear-gradient(${ANGLE}deg, ${bars})`,
          WebkitMaskImage: "linear-gradient(to bottom, #000 30%, rgb(0 0 0 / 0.3))",
          maskImage: "linear-gradient(to bottom, #000 30%, rgb(0 0 0 / 0.3))",
        }}
      />
    </div>
  );
}
