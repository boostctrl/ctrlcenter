import type { SceneProps } from "./index";

// Peaks — layered mountain ridgelines rising from the bottom of the page, each
// nearer range deeper in tone, with a soft mist where they meet the content.
// Hard-edged clip-path silhouettes — deliberately the opposite of the blurry
// gradient scenes. Fully static, so nothing to quiet under
// prefers-reduced-motion. Recolors from the scene vars; lighter tints on light
// surfaces so the ranges read as haze rather than smog.
export default function Peaks({ light }: SceneProps) {
  // Far → near: taller opacity as ranges approach.
  const ranges = [
    {
      color: "var(--scene-to)",
      op: light ? 0.12 : 0.16,
      height: "42%",
      clip: "polygon(0 100%, 0 52%, 9% 30%, 17% 55%, 26% 22%, 36% 58%, 45% 35%, 55% 60%, 66% 18%, 76% 52%, 86% 32%, 100% 58%, 100% 100%)",
    },
    {
      color: "var(--scene-from)",
      op: light ? 0.18 : 0.24,
      height: "30%",
      clip: "polygon(0 100%, 0 65%, 8% 38%, 19% 68%, 31% 28%, 42% 62%, 53% 40%, 63% 70%, 74% 30%, 85% 60%, 94% 44%, 100% 66%, 100% 100%)",
    },
    {
      color: "var(--scene-from)",
      op: light ? 0.26 : 0.36,
      height: "19%",
      clip: "polygon(0 100%, 0 55%, 11% 78%, 22% 35%, 34% 72%, 47% 45%, 58% 80%, 71% 30%, 83% 68%, 92% 50%, 100% 72%, 100% 100%)",
    },
  ];
  const mix = (c: string, op: number) =>
    `color-mix(in srgb, ${c} ${op * 100}%, transparent)`;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "var(--glow-opacity, 1)" }}
    >
      {/* Mist band where the ranges fade into the page. */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background: `linear-gradient(to top, ${mix("var(--scene-from)", light ? 0.1 : 0.12)}, transparent 80%)`,
        }}
      />
      {ranges.map((r, i) => (
        <div
          key={i}
          className="absolute inset-x-0 bottom-0"
          style={{
            height: r.height,
            background: mix(r.color, r.op),
            clipPath: r.clip,
          }}
        />
      ))}
    </div>
  );
}
