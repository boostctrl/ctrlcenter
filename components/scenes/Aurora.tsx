import type { SceneProps } from "./index";

// The default scene: three softly floating accent glow blobs behind everything.
// Lifted from the old hardcoded layout markup; gated by --glow-opacity (designs
// dim or disable it) and recolored by the accent CSS vars. On light surfaces the
// blobs are dimmed so they tint rather than wash out. The float animation is
// disabled under prefers-reduced-motion (see globals.css).
export default function Aurora({ light }: SceneProps) {
  const op = light ? [0.32, 0.24, 0.16] : [0.3, 0.2, 0.15];
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "var(--glow-opacity, 1)" }}
    >
      <div
        className="animate-float absolute -top-32 -left-32 h-96 w-96 rounded-full blur-3xl"
        style={{ backgroundColor: "var(--scene-from)", opacity: op[0] }}
      />
      <div
        className="animate-float absolute top-1/3 -right-32 h-[28rem] w-[28rem] rounded-full blur-3xl"
        style={{ backgroundColor: "var(--scene-to)", opacity: op[1], animationDelay: "4s" }}
      />
      <div
        className="animate-float absolute bottom-0 left-1/4 h-80 w-80 rounded-full blur-3xl"
        style={{ backgroundColor: "var(--scene-from)", opacity: op[2], animationDelay: "8s" }}
      />
    </div>
  );
}
