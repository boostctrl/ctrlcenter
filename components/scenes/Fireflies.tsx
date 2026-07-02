"use client";

import { useEffect, useRef } from "react";
import type { SceneProps } from "./index";
import { effectRgbFor } from "./color";

// Fireflies — a small swarm of softly pulsing lights that wander organically
// (each slowly turns its heading rather than bouncing), drawn as a bright core
// inside a wide soft halo so they glow rather than twinkle. Distinct from
// Starfield: far fewer, larger, no links, and they fade in and out completely.
// A static frame (mid-pulse) is drawn under prefers-reduced-motion.
export default function Fireflies({ light }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = window.devicePixelRatio || 1;
    const peak = light ? 0.85 : 0.9;
    let w = 0;
    let h = 0;
    let colors: [string, string] = ["150, 180, 240", "150, 180, 240"];
    let raf = 0;

    type Fly = {
      x: number;
      y: number;
      r: number;
      heading: number;
      turn: number;
      speed: number;
      phase: number;
      pulse: number;
      c: number;
    };
    let flies: Fly[] = [];

    const spawn = (): Fly => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: (1.2 + Math.random() * 1.6) * dpr,
      heading: Math.random() * Math.PI * 2,
      turn: (Math.random() - 0.5) * 0.03,
      speed: (0.15 + Math.random() * 0.35) * dpr,
      phase: Math.random() * Math.PI * 2,
      pulse: 0.008 + Math.random() * 0.014,
      c: Math.random() < 0.65 ? 0 : 1,
    });

    const resize = () => {
      colors = [effectRgbFor(light, "--accent-from"), effectRgbFor(light, "--accent-to")];
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      const count = Math.max(14, Math.min(34, Math.floor(window.innerWidth / 46)));
      flies = Array.from({ length: count }, spawn);
      if (reduced) drawFrame(true);
    };

    const drawFrame = (still: boolean) => {
      ctx.clearRect(0, 0, w, h);
      for (const f of flies) {
        if (!still) {
          // Wander: drift the heading, occasionally re-aiming the turn.
          f.heading += f.turn;
          if (Math.random() < 0.005) f.turn = (Math.random() - 0.5) * 0.03;
          f.x += Math.cos(f.heading) * f.speed;
          f.y += Math.sin(f.heading) * f.speed;
          f.phase += f.pulse;
          const m = 20 * dpr;
          if (f.x < -m) f.x = w + m;
          else if (f.x > w + m) f.x = -m;
          if (f.y < -m) f.y = h + m;
          else if (f.y > h + m) f.y = -m;
        }
        // Full fade-out at the trough so lights blink out and reappear.
        const a = still ? peak * 0.7 : peak * Math.max(0, Math.sin(f.phase)) ** 2;
        if (a < 0.01) continue;
        const halo = f.r * 6;
        const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, halo);
        grad.addColorStop(0, `rgba(${colors[f.c]}, ${a})`);
        grad.addColorStop(0.25, `rgba(${colors[f.c]}, ${a * 0.35})`);
        grad.addColorStop(1, `rgba(${colors[f.c]}, 0)`);
        ctx.beginPath();
        ctx.arc(f.x, f.y, halo, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
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
