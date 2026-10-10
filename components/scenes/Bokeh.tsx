import type { SceneProps } from "./index";

// Bokeh — nine rimmed, out-of-focus discs of accent light drifting slowly, the
// way point lights render behind a wide-open lens: a slightly hollow centre, a
// brighter rim, a short soft edge. The softness is baked into each disc's
// radial gradient rather than a blur filter, so there is nothing to
// re-rasterise at DPR 2 and the drift is a plain composited transform. Three
// drift classes on three periods (float 20s, drift 32s, bokeh-drift 44s) with
// negative delays scatter the phases, so the field never visibly repeats.
// Glow-gated like Aurora, so a design with no glow (Flat) shows none of it.
// Motion stops under prefers-reduced-motion and the Still level (globals.css).
export default function Bokeh({ light }: SceneProps) {
  // The same light spread over more glass: big discs faint, small ones bright.
  const [lg, md, sm] = light ? [0.24, 0.32, 0.4] : [0.18, 0.24, 0.3];
  const mix = (c: string, op: number) =>
    `color-mix(in srgb, ${c} ${op * 100}%, transparent)`;
  const disc = (c: string, op: number) =>
    `radial-gradient(circle closest-side, ${mix(c, op * 0.55)} 0 66%, ${mix(c, op)} 84% 91%, transparent 100%)`;
  const from = "var(--scene-from)";
  const to = "var(--scene-to)";
  const discs = [
    { c: from, size: 360, top: "2%", left: "4%", op: lg, anim: "animate-drift", delay: "-9s" },
    { c: to, size: 220, top: "16%", left: "30%", op: md, anim: "animate-float", delay: "-4s" },
    { c: from, size: 140, top: "8%", left: "58%", op: sm, anim: "animate-bokeh", delay: "-14s" },
    { c: to, size: 320, top: "-10%", left: "72%", op: lg, anim: "animate-float", delay: "-12s" },
    { c: from, size: 180, top: "44%", left: "84%", op: md, anim: "animate-drift", delay: "-20s" },
    { c: to, size: 120, top: "56%", left: "48%", op: sm, anim: "animate-float", delay: "-7s" },
    { c: from, size: 260, top: "60%", left: "12%", op: md, anim: "animate-bokeh", delay: "-3s" },
    { c: to, size: 150, top: "78%", left: "62%", op: sm, anim: "animate-drift", delay: "-16s" },
    { c: from, size: 300, top: "68%", left: "86%", op: lg, anim: "animate-bokeh", delay: "-25s" },
  ];
  return (
    <div
      aria-hidden
      className="scene-root pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "calc(var(--glow-opacity, 1) * var(--scene-opacity, 1))" }}
    >
      {discs.map((d, i) => (
        <div
          key={i}
          className={`${d.anim} absolute`}
          style={{
            width: d.size,
            height: d.size,
            top: d.top,
            left: d.left,
            backgroundImage: disc(d.c, d.op),
            animationDelay: d.delay,
          }}
        />
      ))}
    </div>
  );
}
