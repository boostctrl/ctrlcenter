// Stub: the scene itself lands in its own commit (see the theming bundle plan).
import type { SceneProps } from "./index";

// Bokeh — up to nine rimmed, out-of-focus discs of accent light drifting
// slowly. Pure CSS: the discs animate with `.animate-bokeh` (keyframes
// `bokeh-drift` in app/globals.css, stilled by both lists there). Glow-gated
// like Aurora, so a design with no glow (Flat) shows none of it.
export default function Bokeh({ light }: SceneProps) {
  const mix = (c: string, op: number) => `color-mix(in srgb, ${c} ${op * 100}%, transparent)`;
  return (
    <div
      aria-hidden
      className="scene-root pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "calc(var(--glow-opacity, 1) * var(--scene-opacity, 1))" }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(40% 40% at 70% 30%, ${mix("var(--scene-to)", light ? 0.16 : 0.12)}, transparent 70%)`,
        }}
      />
    </div>
  );
}
