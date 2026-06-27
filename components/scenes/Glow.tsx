import type { SceneProps } from "./index";

// Glow — a single broad accent glow centred behind everything, slowly breathing.
// A radial gradient from the accent pair, recolored by the accent vars and dimmer
// on light surfaces. Centred via the breathe animation's translate; the pulse
// stops under prefers-reduced-motion (.animate-breathe in globals.css).
export default function Glow({ light }: SceneProps) {
  const op = light ? 0.5 : 0.7;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "var(--glow-opacity, 1)" }}
    >
      <div
        className="animate-breathe absolute top-1/2 left-1/2 h-[80vmax] w-[80vmax] rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle, color-mix(in srgb, var(--scene-from) ${
            op * 100
          }%, transparent), color-mix(in srgb, var(--scene-to) ${
            op * 60
          }%, transparent) 45%, transparent 70%)`,
        }}
      />
    </div>
  );
}
