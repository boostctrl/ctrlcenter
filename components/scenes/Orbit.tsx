import type { SceneProps } from "./index";

// Orbit — astronomical line-art: concentric orbit rings around an anchor in the
// upper right, each carrying a small glowing planet. The rings are bordered
// circles; each spins about its centre (reusing .animate-spin-slow) so the
// planet dot on its rim travels the orbit — negative delays stagger the planets
// while animating, and the static base rotation keeps them scattered when
// prefers-reduced-motion disables the spin. Recolors from the scene vars;
// slightly stronger lines on light so the hairlines stay visible.
export default function Orbit({ light }: SceneProps) {
  const ring = light ? 0.34 : 0.28;
  const planet = light ? 0.85 : 0.9;
  // Ring diameter (vmin), spin duration (s), stagger (deg / s), planet size (px).
  const orbits = [
    { size: 52, dur: 46, angle: 40, dot: 6 },
    { size: 84, dur: 74, angle: 160, dot: 8 },
    { size: 118, dur: 108, angle: 250, dot: 7 },
    { size: 154, dur: 150, angle: 330, dot: 9 },
  ];
  const mix = (c: string, op: number) =>
    `color-mix(in srgb, ${c} ${op * 100}%, transparent)`;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "var(--glow-opacity, 1)" }}
    >
      {/* A soft core glow at the anchor the orbits circle. */}
      <div
        className="absolute top-[12%] left-[78%] h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl"
        style={{
          background: `radial-gradient(circle, ${mix("var(--scene-from)", light ? 0.4 : 0.5)}, transparent 70%)`,
        }}
      />
      {orbits.map((o, i) => (
        <div
          key={i}
          className="animate-spin-slow absolute top-[12%] left-[78%] rounded-full"
          style={{
            height: `${o.size}vmin`,
            width: `${o.size}vmin`,
            marginTop: `${-o.size / 2}vmin`,
            marginLeft: `${-o.size / 2}vmin`,
            border: `1px solid ${mix(i % 2 ? "var(--scene-to)" : "var(--scene-from)", ring)}`,
            transform: `rotate(${o.angle}deg)`,
            animationDuration: `${o.dur}s`,
            animationDelay: `${-(o.angle / 360) * o.dur}s`,
          }}
        >
          {/* The planet rides the ring's top edge; the ring's spin orbits it. */}
          <span
            className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              height: o.dot,
              width: o.dot,
              background: mix(i % 2 ? "var(--scene-to)" : "var(--scene-from)", planet),
              boxShadow: `0 0 ${o.dot * 2}px ${mix(i % 2 ? "var(--scene-to)" : "var(--scene-from)", 0.6)}`,
            }}
          />
        </div>
      ))}
    </div>
  );
}
