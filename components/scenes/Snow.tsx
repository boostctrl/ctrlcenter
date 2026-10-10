// Stub: the scene itself lands in its own commit (see the theming bundle plan).
import type { SceneProps } from "./index";

// Snow — round flakes in three depth bands drifting down on a shared gust,
// fluttering sideways. A canvas scene on the Petals skeleton: one still frame
// under reduced motion, every other frame under calm. Not glow-gated.
export default function Snow({ light }: SceneProps) {
  const mix = (c: string, op: number) => `color-mix(in srgb, ${c} ${op * 100}%, transparent)`;
  return (
    <div aria-hidden className="scene-root pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to bottom, ${mix("var(--scene-from)", light ? 0.1 : 0.08)}, transparent 60%)`,
        }}
      />
    </div>
  );
}
