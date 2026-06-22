import type { SceneProps } from "./index";

// Nebula — drifting clouds of accent light: several large, soft radial-gradient
// blobs (a richer cousin of Aurora) that slowly drift and rotate. Recolors from
// the accent vars; dimmer and softer on light surfaces so it reads as a pastel
// wash rather than washing out. Motion stops under prefers-reduced-motion.
export default function Nebula({ light }: SceneProps) {
  const op = light ? 0.5 : 0.85;
  const clouds = [
    {
      color: "var(--accent-from)",
      className: "-top-1/4 -left-1/4 h-[42rem] w-[42rem]",
      delay: "0s",
    },
    {
      color: "var(--accent-to)",
      className: "top-1/4 -right-1/4 h-[38rem] w-[38rem]",
      delay: "-8s",
    },
    {
      color: "var(--accent-from)",
      className: "bottom-[-20%] left-1/3 h-[34rem] w-[34rem]",
      delay: "-16s",
    },
    {
      color: "var(--accent-to)",
      className: "top-1/3 left-1/4 h-[26rem] w-[26rem]",
      delay: "-24s",
    },
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
          className={`animate-drift absolute rounded-full blur-3xl ${c.className}`}
          style={{
            background: `radial-gradient(circle, color-mix(in srgb, ${c.color} ${
              op * 100
            }%, transparent) 0%, transparent 70%)`,
            animationDelay: c.delay,
          }}
        />
      ))}
    </div>
  );
}
