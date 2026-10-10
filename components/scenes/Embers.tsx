// Stub: the scene itself lands in its own commit (see the theming bundle plan).
import type { SceneProps } from "./index";

// Embers — sparks lifting off the base of the page, fading as they climb,
// each flickering slowly (under 2 Hz). A canvas scene on the Petals skeleton
// with its halo sprite pre-rendered once in resize(). Not glow-gated.
export default function Embers({ light }: SceneProps) {
  const mix = (c: string, op: number) => `color-mix(in srgb, ${c} ${op * 100}%, transparent)`;
  return (
    <div aria-hidden className="scene-root pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background: `linear-gradient(to top, ${mix("var(--scene-from)", light ? 0.14 : 0.12)}, transparent 80%)`,
        }}
      />
    </div>
  );
}
