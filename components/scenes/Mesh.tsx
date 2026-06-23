import type { SceneProps } from "./index";

// Mesh — a soft mesh gradient: several big accent blobs that slowly morph across
// the viewport on offset cycles, so the blend keeps shifting without repeating.
// Recolors from the accent vars; gentler on light surfaces. Motion stops under
// prefers-reduced-motion (see .animate-mesh).
export default function Mesh({ light }: SceneProps) {
  const op = light ? 0.4 : 0.7;
  const blobs = [
    { color: "var(--accent-from)", className: "-top-1/3 -left-1/4 h-[48rem] w-[48rem]", delay: "0s" },
    { color: "var(--accent-to)", className: "-top-1/4 right-[-15%] h-[44rem] w-[44rem]", delay: "-13s" },
    { color: "var(--accent-to)", className: "bottom-[-25%] left-[-10%] h-[42rem] w-[42rem]", delay: "-26s" },
    { color: "var(--accent-from)", className: "bottom-[-20%] right-1/4 h-[40rem] w-[40rem]", delay: "-33s" },
  ];
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "var(--glow-opacity, 1)" }}
    >
      {blobs.map((b, i) => (
        <div
          key={i}
          className={`animate-mesh absolute rounded-full blur-[80px] ${b.className}`}
          style={{
            background: `radial-gradient(circle, color-mix(in srgb, ${b.color} ${
              op * 100
            }%, transparent) 0%, transparent 70%)`,
            animationDelay: b.delay,
          }}
        />
      ))}
    </div>
  );
}
