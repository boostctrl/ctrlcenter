// Stub: the scene itself lands in its own commit (see the theming bundle plan).
import type { SceneProps } from "./index";

// Glyphs — columns of terminal glyphs raining down the page, each column's
// leading glyph lit in the accent and the trail fading behind it. A canvas
// scene on the Petals skeleton (glyphs pre-rendered to a sprite sheet in
// resize(); per-glyph changes well under 2 Hz). Not glow-gated.
export default function Glyphs({ light }: SceneProps) {
  const mix = (c: string, op: number) => `color-mix(in srgb, ${c} ${op * 100}%, transparent)`;
  return (
    <div aria-hidden className="scene-root pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to bottom, ${mix("var(--scene-from)", light ? 0.12 : 0.1)}, transparent 50%)`,
        }}
      />
    </div>
  );
}
