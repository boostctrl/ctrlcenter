// Stub: the scene itself lands in its own commit (see the theming bundle plan).
import type { SceneProps } from "./index";

// Beams — broad diagonal bars of accent light sweeping slowly across the
// page. Pure CSS: the bars animate with `.animate-beams` (keyframes
// `beam-sweep` in app/globals.css, stilled by both lists there). Glow-gated
// like Rays, so a design with no glow (Flat) shows none of it.
export default function Beams({ light }: SceneProps) {
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
          background: `linear-gradient(115deg, transparent 30%, ${mix("var(--scene-from)", light ? 0.14 : 0.1)} 45% 55%, transparent 70%)`,
        }}
      />
    </div>
  );
}
