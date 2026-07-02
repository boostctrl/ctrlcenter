"use client";

import { useEffect, useRef } from "react";
import type { SceneProps } from "./index";
import { effectRgbFor } from "./color";

// Petals — cherry-blossom petals adrift on a gentle breeze: small translucent
// petal shapes in both accent tones that fall slowly while swaying side to
// side and turning. Distinct from Rain (dense straight streaks) and Fireflies
// (stationary pulsing glows): these are solid little shapes with lateral
// drift. A static mid-fall scatter is drawn under prefers-reduced-motion.
export default function Petals({ light }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = window.devicePixelRatio || 1;
    // Translucent so they read as petals over the surface, not confetti.
    const alpha = light ? 0.5 : 0.55;
    let w = 0;
    let h = 0;
    let colors: [string, string] = ["150, 180, 240", "150, 180, 240"];
    let raf = 0;

    type Petal = {
      x: number;
      y: number;
      r: number; // base size
      squish: number; // ellipse aspect, so petals vary
      fall: number; // vertical speed
      sway: number; // lateral sway amplitude
      phase: number; // sway phase
      angle: number;
      spin: number;
      c: number;
    };
    let petals: Petal[] = [];

    // anywhereY seeds the initial field across the screen; falling respawns
    // enter just above the top so there's no pop-in.
    const spawn = (anywhereY: boolean): Petal => ({
      x: Math.random() * w,
      y: anywhereY ? Math.random() * h : -12 * dpr,
      r: (2.4 + Math.random() * 2.6) * dpr,
      squish: 0.45 + Math.random() * 0.25,
      fall: (0.25 + Math.random() * 0.5) * dpr,
      sway: (0.3 + Math.random() * 0.5) * dpr,
      phase: Math.random() * Math.PI * 2,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.02,
      c: Math.random() < 0.7 ? 0 : 1,
    });

    const resize = () => {
      colors = [effectRgbFor(light, "--accent-from"), effectRgbFor(light, "--accent-to")];
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      const count = Math.max(16, Math.min(40, Math.floor(window.innerWidth / 40)));
      petals = Array.from({ length: count }, () => spawn(true));
      if (reduced) drawFrame(true);
    };

    const drawFrame = (still: boolean) => {
      ctx.clearRect(0, 0, w, h);
      for (const p of petals) {
        if (!still) {
          p.phase += 0.015;
          p.angle += p.spin;
          p.x += Math.sin(p.phase) * p.sway;
          p.y += p.fall;
          const m = 16 * dpr;
          if (p.y > h + m) Object.assign(p, spawn(false));
          if (p.x < -m) p.x = w + m;
          else if (p.x > w + m) p.x = -m;
        }
        // A petal: a rotated ellipse pinched by a brighter core, so it reads
        // as a soft blossom piece rather than a dot.
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * p.squish, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colors[p.c]}, ${alpha})`;
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(p.r * 0.25, 0, p.r * 0.45, p.r * p.squish * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colors[p.c]}, ${alpha * 0.7})`;
        ctx.fill();
        ctx.restore();
      }
    };

    const draw = () => {
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
  }, [light]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
