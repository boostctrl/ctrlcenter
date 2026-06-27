import type { SceneProps } from "./index";

// Rays — broad beams of accent light fanning out from above (crepuscular rays /
// aurora curtains): two offset repeating-conic-gradients in the accent colors,
// masked to fade toward the edges and gently swept side to side. Structurally
// unlike the soft-blob scenes. Recolors from the accent vars; on light surfaces
// the beams stay strong enough to read. Sweep stops under prefers-reduced-motion
// (see .animate-rays in globals.css).
export default function Rays({ light }: SceneProps) {
  const a = light ? 0.5 : 0.8;
  const b = light ? 0.34 : 0.55;
  const beam = (c: string, op: number, off: number) =>
    `repeating-conic-gradient(from ${off}deg at 50% 0%, color-mix(in srgb, ${c} ${
      op * 100
    }%, transparent) 0deg 3deg, transparent 3deg 13deg)`;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "var(--glow-opacity, 1)" }}
    >
      <div
        className="animate-rays absolute top-[-20%] left-1/2 h-[130vmax] w-[130vmax]"
        style={{
          backgroundImage: `${beam("var(--scene-from)", a, 0)}, ${beam(
            "var(--scene-to)",
            b,
            6
          )}`,
          WebkitMaskImage:
            "radial-gradient(70% 70% at 50% 0%, #000 8%, transparent 68%)",
          maskImage:
            "radial-gradient(70% 70% at 50% 0%, #000 8%, transparent 68%)",
          filter: "blur(3px)",
        }}
      />
    </div>
  );
}
