"use client";

import { useEffect, useRef } from "react";
import type { SceneProps } from "./index";
import { effectRgbFor } from "./color";

// Rain — gentle accent rain: thin streaks falling at a slight, shared angle
// with varied speed, length and opacity, alternating between the two accent
// stops. A faint wash at the base suggests where it lands. A single static
// frame is drawn under prefers-reduced-motion.
export default function Rain({ light }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = window.devicePixelRatio || 1;
    const alpha = light ? 0.4 : 0.34;
    // A shared wind angle so the shower reads as one weather system.
    const slant = 0.18;
    let w = 0;
    let h = 0;
    let colors: [string, string] = ["150, 180, 240", "150, 180, 240"];
    let raf = 0;

    type Drop = {
      x: number;
      y: number;
      len: number;
      vy: number;
      a: number;
      c: number; // color index
    };
    let drops: Drop[] = [];

    const spawn = (): Drop => {
      const depth = Math.random(); // far (0) → near (1): faster, longer, brighter
      return {
        x: Math.random() * (w + h * slant) - h * slant,
        y: Math.random() * h,
        len: (10 + depth * 22) * dpr,
        vy: (2.2 + depth * 4.5) * dpr,
        a: alpha * (0.35 + depth * 0.65),
        c: Math.random() < 0.7 ? 0 : 1,
      };
    };

    const resize = () => {
      colors = [effectRgbFor(light, "--accent-from"), effectRgbFor(light, "--accent-to")];
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      const count = Math.min(150, Math.floor(window.innerWidth / 11));
      drops = Array.from({ length: count }, spawn);
      if (reduced) drawFrame(true);
    };

    const drawFrame = (still: boolean) => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = dpr;
      ctx.lineCap = "round";
      for (const d of drops) {
        if (!still) {
          d.y += d.vy;
          d.x += d.vy * slant;
          if (d.y - d.len > h) {
            const fresh = spawn();
            fresh.y = -fresh.len;
            Object.assign(d, fresh);
          }
        }
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * slant, d.y - d.len);
        ctx.strokeStyle = `rgba(${colors[d.c]}, ${d.a})`;
        ctx.stroke();
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
      {/* A faint pooling wash along the base. */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/4"
        style={{
          background: `linear-gradient(to top, color-mix(in srgb, var(--scene-from) ${
            light ? 10 : 12
          }%, transparent), transparent 80%)`,
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
