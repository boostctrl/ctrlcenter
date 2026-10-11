import type { SceneProps } from "./index";

// Topography — a relief map: nested contour lines around three summits, every
// fifth line heavier (a map's index contours), the spacing tighter where the
// slope is steeper. Each summit is one layer: a pair of repeating-radial-
// gradients on the same centre — the fine lines and, at five times their
// spacing, the heavier index lines, so an index line always lands on a fine
// one — over a whisper of hypsometric tint, masked to the summit's own hollow.
// The hollow reaches about zero before the next summit's rings begin, so
// the sets do not cross and weave a moiré lattice between them; where two
// hollows brush, both are faint and it reads as a fade. A line drawing rather
// than a glow, so it is not gated by --glow-opacity (Flat keeps it); fully
// still (`still: true` in SCENES), so nothing to quiet under reduced motion.
// Recolors from the scene vars; stronger on light, where hairlines must
// survive the pale surface and the page wash.
export default function Topography({ light }: SceneProps) {
  const fine = light ? 0.14 : 0.1;
  const heavy = light ? 0.26 : 0.2;
  const tint = light ? 0.07 : 0.06;
  const mix = (c: string, op: number) =>
    `color-mix(in srgb, ${c} ${op * 100}%, transparent)`;
  // Ring shapes are in px so a summit keeps its aspect on any viewport; the
  // mask is in percentages so each hollow stays proportional to the page.
  // The hollow ramp (solid to 25%, gone by 62% of the mask's radius) is what
  // keeps the sets apart: the full-radius ramp let two and three ring sets
  // overlap at half strength across the middle of the page.
  const summits = [
    { color: "var(--scene-from)", at: "22% 40%", shape: "520px 400px", gap: 26, mask: "58% 66%" },
    { color: "var(--scene-to)", at: "80% 66%", shape: "440px 480px", gap: 20, mask: "50% 62%" },
    { color: "var(--scene-from)", at: "58% 6%", shape: "380px 300px", gap: 18, mask: "40% 48%" },
  ];
  const rings = (s: (typeof summits)[number], op: number, width: number, gap: number) =>
    `repeating-radial-gradient(ellipse ${s.shape} at ${s.at}, ${mix(s.color, op)} 0 ${width}px, transparent ${
      width + 0.5
    }px ${gap}px)`;
  return (
    <div aria-hidden className="scene-root pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {summits.map((s, i) => {
        const hollow = `radial-gradient(${s.mask} at ${s.at}, #000 25%, transparent 62%)`;
        return (
          <div
            key={i}
            className="absolute inset-0"
            style={{
              backgroundImage: [
                rings(s, heavy, 2, s.gap * 5),
                rings(s, fine, 1, s.gap),
                `radial-gradient(ellipse ${s.shape} at ${s.at}, ${mix(s.color, tint)}, transparent 70%)`,
              ].join(", "),
              WebkitMaskImage: hollow,
              maskImage: hollow,
            }}
          />
        );
      })}
    </div>
  );
}
