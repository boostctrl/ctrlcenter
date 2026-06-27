import type { SceneProps } from "./index";

// Dots — a soft halftone field of accent dots drifting slowly behind everything.
// Two offset repeating radial-gradients recolored by the accent vars, on an
// oversized layer so the drift never reveals an edge, masked to fade toward the
// edges. Gated by --glow-opacity and dimmed on light surfaces. The drift stops
// under prefers-reduced-motion (.animate-drift in globals.css).
export default function Dots({ light }: SceneProps) {
  const a = light ? 0.22 : 0.3;
  const b = light ? 0.16 : 0.22;
  const dot = (c: string, op: number) =>
    `radial-gradient(color-mix(in srgb, ${c} ${op * 100}%, transparent) 1.5px, transparent 1.6px)`;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "var(--glow-opacity, 1)" }}
    >
      <div
        className="animate-drift absolute -top-1/4 -left-1/4 h-[150%] w-[150%]"
        style={{
          backgroundImage: `${dot("var(--scene-from)", a)}, ${dot("var(--scene-to)", b)}`,
          backgroundPosition: "0 0, 14px 14px",
          backgroundSize: "28px 28px, 28px 28px",
          WebkitMaskImage:
            "radial-gradient(80% 80% at 50% 40%, #000 30%, transparent 80%)",
          maskImage:
            "radial-gradient(80% 80% at 50% 40%, #000 30%, transparent 80%)",
        }}
      />
    </div>
  );
}
