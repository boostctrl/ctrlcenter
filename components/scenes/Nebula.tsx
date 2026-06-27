import type { SceneProps } from "./index";

// Nebula — a dense, textured cloudbank of accent light: many overlapping
// radial-gradient blobs at varied sizes and offsets, layered so they read as a
// rich, filling nebula rather than Aurora's few sparse floating orbs. Recolors
// from the accent vars; on light surfaces it stays a visible pastel wash. Motion
// stops under prefers-reduced-motion (see .animate-drift).
export default function Nebula({ light }: SceneProps) {
  const op = light ? 0.6 : 0.85;
  const clouds = [
    { color: "var(--scene-from)", className: "-top-1/4 -left-[15%] h-[40rem] w-[40rem]", delay: "0s" },
    { color: "var(--scene-to)", className: "-top-[10%] right-[-12%] h-[36rem] w-[36rem]", delay: "-6s" },
    { color: "var(--scene-from)", className: "top-1/4 left-1/3 h-[30rem] w-[30rem]", delay: "-12s" },
    { color: "var(--scene-to)", className: "bottom-[-18%] left-[8%] h-[34rem] w-[34rem]", delay: "-18s" },
    { color: "var(--scene-from)", className: "bottom-[-12%] right-1/4 h-[28rem] w-[28rem]", delay: "-24s" },
    { color: "var(--scene-to)", className: "top-[42%] left-1/2 h-[22rem] w-[22rem]", delay: "-30s" },
    { color: "var(--scene-from)", className: "top-[8%] left-[42%] h-[18rem] w-[18rem]", delay: "-15s" },
  ];
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "var(--glow-opacity, 1)" }}
    >
      {clouds.map((c, i) => (
        <div
          key={i}
          className={`animate-drift absolute rounded-full blur-2xl ${c.className}`}
          style={{
            background: `radial-gradient(circle, color-mix(in srgb, ${c.color} ${
              op * 100
            }%, transparent) 0%, transparent 68%)`,
            animationDelay: c.delay,
          }}
        />
      ))}
    </div>
  );
}
