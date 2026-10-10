// Stub: the scene itself lands in its own commit (see the theming bundle plan).
import type { SceneProps } from "./index";

// Bubbles — stroked rings rising from the base, wobbling as they climb and
// popping in the top third. A canvas scene: the Abyss skeleton inverted,
// strokes only, no gradients. Not glow-gated.
export default function Bubbles({ light }: SceneProps) {
  const mix = (c: string, op: number) => `color-mix(in srgb, ${c} ${op * 100}%, transparent)`;
  return (
    <div aria-hidden className="scene-root pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-x-0 bottom-0 h-2/3"
        style={{
          background: `linear-gradient(to top, ${mix("var(--scene-to)", light ? 0.12 : 0.1)}, transparent 85%)`,
        }}
      />
    </div>
  );
}
