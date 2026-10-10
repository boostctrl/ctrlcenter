// Stub: the scene itself lands in its own commit (see the theming bundle plan).
import type { SceneProps } from "./index";

// Topography — nested contour lines from three centres, every fifth line
// heavier, like a map's relief. Fully still (`still: true` in SCENES), so
// nothing to quiet under reduced motion; not glow-gated, since it is a line
// drawing rather than a glow. Recolors from the scene vars.
export default function Topography({ light }: SceneProps) {
  const mix = (c: string, op: number) => `color-mix(in srgb, ${c} ${op * 100}%, transparent)`;
  return (
    <div aria-hidden className="scene-root pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(60% 50% at 30% 40%, ${mix("var(--scene-from)", light ? 0.14 : 0.1)}, transparent 70%)`,
        }}
      />
    </div>
  );
}
