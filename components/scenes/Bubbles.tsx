"use client";

import { useEffect, useRef } from "react";
import type { SceneProps } from "./index";
import { effectRgbFor } from "./color";

// Bubbles — rings rising from the base: each wobbles sideways as it climbs,
// swells a little as the pressure eases, and pops somewhere in the top third,
// a quick three-frame burst of the ring and then gone, while a fresh one
// leaves the bottom. The Abyss skeleton run upward, in strokes only: a ring
// and a short highlight arc on its upper shoulder, no fills or gradients, so
// the surface stays readable through them. Distinct from Bokeh (filled discs
// that drift) and Fireflies (pulsing glows). A scattered mid-rise field is
// drawn under reduced motion.
export default function Bubbles({ light, motion }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Calm motion: advance every other frame — half speed, half the work.
    const calm = motion === "calm";
    let tick = 0;
    const dpr = window.devicePixelRatio || 1;
    // Stroke alpha: thin rings vanish faster than fills, so these sit higher
    // than a particle scene's, and light gets +0.15 under the 40% page wash.
    const lift = light ? 0.15 : 0;
    let w = 0;
    let h = 0;
    let colors: [string, string] = ["150, 180, 240", "150, 180, 240"];
    let raf = 0;

    type Bubble = {
      x: number;
      y: number;
      r0: number; // radius when it leaves the base; it swells on the way up
      vy: number; // rise per frame
      lw: number; // stroke width
      amp: number; // wobble amplitude
      freq: number; // wobble rate, radians per frame
      phase: number;
      popY: number; // the height it pops at, somewhere in the top third
      pop: number; // 0 while rising, else the burst frame (1–3)
      style: string;
    };
    let bubbles: Bubble[] = [];

    // Re-seeds a bubble in place (no allocation per respawn). `anywhereY`
    // scatters the initial field between the base and each one's pop height;
    // a respawn starts below the bottom edge, staggered so the refills don't
    // arrive as a wave. Sizes skew small, and the bigger bubbles rise and
    // wobble more, as they do in water.
    const seed = (b: Bubble, anywhereY: boolean) => {
      const size = 3 + 11 * Math.random() ** 1.6; // CSS px
      b.r0 = size * dpr;
      b.vy = (0.45 + 0.05 * size) * (0.85 + Math.random() * 0.3) * dpr;
      b.lw = (0.9 + 0.025 * size) * dpr;
      b.amp = (0.15 + 0.03 * size) * dpr;
      b.freq = 0.03 + Math.random() * 0.03;
      b.phase = Math.random() * Math.PI * 2;
      b.popY = h * (0.04 + Math.random() * 0.29);
      b.pop = 0;
      b.x = b.r0 * 1.5 + Math.random() * (w - b.r0 * 3);
      b.y = anywhereY ? b.popY + Math.random() * (h - b.popY) : h + b.r0 + Math.random() * h * 0.3;
      const c = Math.random() < 0.6 ? 0 : 1;
      b.style = `rgba(${colors[c]}, ${0.28 + lift + Math.random() * 0.17})`;
    };

    const resize = () => {
      colors = [effectRgbFor(light, "--accent-from"), effectRgbFor(light, "--accent-to")];
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      const count = Math.max(10, Math.min(36, Math.floor(window.innerWidth / 36)));
      bubbles = Array.from({ length: count }, () => {
        const b: Bubble = {
          x: 0,
          y: 0,
          r0: 0,
          vy: 0,
          lw: 0,
          amp: 0,
          freq: 0,
          phase: 0,
          popY: 0,
          pop: 0,
          style: "",
        };
        seed(b, true);
        return b;
      });
      if (reduced) drawFrame(true);
    };

    const drawFrame = (still: boolean) => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      for (const b of bubbles) {
        if (!still) {
          if (b.pop) {
            // Three burst frames, then back to the base.
            if (++b.pop > 3) {
              seed(b, false);
              continue;
            }
          } else {
            b.phase += b.freq;
            b.y -= b.vy;
            b.x += Math.sin(b.phase) * b.amp;
            if (b.y <= b.popY) b.pop = 1;
          }
        }
        // Swells by a quarter from the base to the top; the burst then flings
        // the ring outward as it fades.
        let r = b.r0 * (1 + 0.25 * Math.max(0, 1 - b.y / h));
        if (b.y - r > h) continue; // still queued below the edge
        if (b.pop) {
          r *= 1 + 0.3 * b.pop;
          ctx.globalAlpha = 1 - b.pop / 4;
        }
        ctx.strokeStyle = b.style;
        ctx.lineWidth = b.lw;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.stroke();
        if (b.pop) {
          ctx.globalAlpha = 1;
        } else {
          // The glint: a short, heavier arc inside the upper-left shoulder,
          // which is what makes a ring read as a bubble under a light.
          ctx.lineWidth = b.lw * 1.6;
          ctx.beginPath();
          ctx.arc(b.x, b.y, r * 0.68, Math.PI * 1.1, Math.PI * 1.42);
          ctx.stroke();
        }
      }
    };

    const draw = () => {
      if (calm && (tick++ & 1)) {
        raf = requestAnimationFrame(draw);
        return;
      }
      drawFrame(false);
      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    if (!reduced) draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, [light, motion]);

  return (
    <div aria-hidden className="scene-root pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
