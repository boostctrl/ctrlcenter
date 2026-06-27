import type { SceneProps } from "./index";

// Vortex — a slow rotating sweep of accent light from the centre (radar-like): a
// conic gradient in the accent colors, masked to a soft disc and spun. Centred by
// the flex wrapper so the spin pivots about its own centre. Recolors from the
// accent vars; dimmer on light surfaces. The spin stops under
// prefers-reduced-motion (.animate-spin-slow in globals.css).
export default function Vortex({ light }: SceneProps) {
  const a = light ? 0.4 : 0.6;
  const b = light ? 0.28 : 0.42;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 flex items-center justify-center overflow-hidden"
      style={{ opacity: "var(--glow-opacity, 1)" }}
    >
      <div
        className="animate-spin-slow h-[140vmax] w-[140vmax] rounded-full blur-2xl"
        style={{
          backgroundImage: `conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--scene-from) ${
            a * 100
          }%, transparent) 40deg, transparent 110deg, color-mix(in srgb, var(--scene-to) ${
            b * 100
          }%, transparent) 200deg, transparent 280deg)`,
          WebkitMaskImage:
            "radial-gradient(50% 50% at 50% 50%, #000 10%, transparent 70%)",
          maskImage:
            "radial-gradient(50% 50% at 50% 50%, #000 10%, transparent 70%)",
        }}
      />
    </div>
  );
}
