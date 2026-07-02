"use client";

import { useEffect, useRef } from "react";
import type { SceneProps } from "./index";
import { effectRgbFor } from "./color";

// Prisms — translucent geometric shards (triangles and quads) drifting slowly
// upward while rotating, stroked in the accent with a faint fill, alternating
// between the two gradient stops. The only geometric-shape scene in the
// catalog. A static frame is drawn under prefers-reduced-motion.
export default function Prisms({ light }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = window.devicePixelRatio || 1;
    const strokeA = light ? 0.4 : 0.34;
    const fillA = light ? 0.08 : 0.07;
    let w = 0;
    let h = 0;
    let colors: [string, string] = ["150, 180, 240", "150, 180, 240"];
    let raf = 0;

    type Shard = {
      x: number;
      y: number;
      size: number;
      sides: number; // 3 or 4
      angle: number;
      spin: number;
      vy: number;
      drift: number;
      a: number; // 0–1 depth factor scaling opacity
      c: number;
    };
    let shards: Shard[] = [];

    const spawn = (): Shard => {
      const depth = Math.random();
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        size: (14 + depth * 40) * dpr,
        sides: Math.random() < 0.6 ? 3 : 4,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.004,
        vy: (0.1 + depth * 0.3) * dpr,
        drift: (Math.random() - 0.5) * 0.12 * dpr,
        a: 0.35 + depth * 0.65,
        c: Math.random() < 0.55 ? 0 : 1,
      };
    };

    const resize = () => {
      colors = [effectRgbFor(light, "--accent-from"), effectRgbFor(light, "--accent-to")];
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      const count = Math.max(8, Math.min(18, Math.floor(window.innerWidth / 90)));
      shards = Array.from({ length: count }, spawn);
      if (reduced) drawFrame(true);
    };

    const trace = (s: Shard) => {
      ctx.beginPath();
      for (let i = 0; i < s.sides; i++) {
        const t = s.angle + (i / s.sides) * Math.PI * 2;
        const px = s.x + Math.cos(t) * s.size;
        const py = s.y + Math.sin(t) * s.size;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    const drawFrame = (still: boolean) => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = dpr;
      for (const s of shards) {
        if (!still) {
          s.y -= s.vy;
          s.x += s.drift;
          s.angle += s.spin;
          const m = s.size * 1.5;
          if (s.y < -m) {
            const fresh = spawn();
            fresh.y = h + fresh.size * 1.5;
            Object.assign(s, fresh);
          }
          if (s.x < -m) s.x = w + m;
          else if (s.x > w + m) s.x = -m;
        }
        trace(s);
        ctx.fillStyle = `rgba(${colors[s.c]}, ${fillA * s.a})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${colors[s.c]}, ${strokeA * s.a})`;
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
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
