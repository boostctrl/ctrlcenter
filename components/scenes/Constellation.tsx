"use client";

import { useEffect, useRef } from "react";
import type { SceneProps } from "./index";
import { effectRgb } from "./color";

// Constellation — drifting nodes with faint links drawn between near neighbours,
// like a slowly rearranging star map / network. Recolors from the accent (blended
// toward the ink on light surfaces so it reads). A single static frame is drawn
// under prefers-reduced-motion.
export default function Constellation({ light }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = window.devicePixelRatio || 1;
    const nodeAlpha = light ? 0.8 : 0.75;
    const linkAlpha = light ? 0.42 : 0.3;
    let w = 0;
    let h = 0;
    let link = 0; // squared max link distance
    let rgb = effectRgb(light);
    let nodes: { x: number; y: number; r: number; vx: number; vy: number }[] = [];
    let raf = 0;

    const spawn = () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: (Math.random() * 1.4 + 0.6) * dpr,
      vx: (Math.random() - 0.5) * 0.12 * dpr,
      vy: (Math.random() - 0.5) * 0.12 * dpr,
    });

    const resize = () => {
      rgb = effectRgb(light);
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      const count = Math.min(110, Math.floor((window.innerWidth * window.innerHeight) / 16000));
      const d = 140 * dpr;
      link = d * d;
      nodes = Array.from({ length: count }, spawn);
      if (reduced) drawFrame(true);
    };

    const drawFrame = (still: boolean) => {
      ctx.clearRect(0, 0, w, h);
      // Links first, so nodes sit on top.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > link) continue;
          const t = 1 - dist2 / link;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(${rgb}, ${linkAlpha * t})`;
          ctx.lineWidth = dpr * 0.6;
          ctx.stroke();
        }
      }
      for (const n of nodes) {
        if (!still) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < -2) n.x = w + 2;
          else if (n.x > w + 2) n.x = -2;
          if (n.y < -2) n.y = h + 2;
          else if (n.y > h + 2) n.y = -2;
        }
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb}, ${nodeAlpha})`;
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
