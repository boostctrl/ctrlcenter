import type { SceneProps } from "./index";

// Mesh — a full-bleed mesh gradient: accent glows anchored near the four corners
// that drift slowly and blend into a soft coloured wash. An oversized layer of
// overlapping radial-gradients recolored by the accent vars; calmer on light
// surfaces. The drift stops under prefers-reduced-motion (.animate-drift in
// globals.css).
export default function Mesh({ light }: SceneProps) {
  const a = light ? 0.3 : 0.42;
  const b = light ? 0.22 : 0.34;
  const mix = (c: string, op: number) =>
    `color-mix(in srgb, ${c} ${op * 100}%, transparent)`;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "var(--glow-opacity, 1)" }}
    >
      <div
        className="animate-drift absolute -top-1/4 -left-1/4 h-[150%] w-[150%] blur-2xl"
        style={{
          backgroundImage: `radial-gradient(40% 50% at 18% 22%, ${mix(
            "var(--scene-from)",
            a
          )}, transparent 60%), radial-gradient(45% 55% at 82% 18%, ${mix(
            "var(--scene-to)",
            b
          )}, transparent 60%), radial-gradient(50% 55% at 78% 80%, ${mix(
            "var(--scene-from)",
            a
          )}, transparent 62%), radial-gradient(45% 50% at 20% 82%, ${mix(
            "var(--scene-to)",
            b
          )}, transparent 60%)`,
        }}
      />
    </div>
  );
}
