"use client";

import { useEffect, useRef } from "react";
import type { SceneProps } from "./index";
import { effectRgb } from "./color";

// Starfield — a dense field of twinkling, drifting stars with a few linked
// constellations scattered through it. Dark = a glowing night sky; light =
// deeper, contrasting motes (the accent blended toward the ink). A single static
// frame is drawn under prefers-reduced-motion.
export default function Starfield({ light }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = window.devicePixelRatio || 1;
    const peak = light ? 0.9 : 0.9;
    const nodeAlpha = light ? 0.85 : 0.8;
    const linkAlpha = light ? 0.4 : 0.32;
    let w = 0;
    let h = 0;
    let rgb = effectRgb(light);
    let raf = 0;

    type Star = {
      x: number;
      y: number;
      r: number;
      vx: number;
      vy: number;
      phase: number;
      tw: number;
      base: number;
    };
    // A constellation is a small cluster of brighter nodes that drift within a
    // local box (so the group stays together) with faint links between near ones.
    type Node = { x: number; y: number; r: number; vx: number; vy: number };
    type Constellation = {
      nodes: Node[];
      box: { x0: number; y0: number; x1: number; y1: number };
      link2: number; // squared max link distance
    };
    let stars: Star[] = [];
    let constellations: Constellation[] = [];

    const star = (): Star => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: (Math.random() * 1.3 + 0.3) * dpr,
      vx: (Math.random() - 0.5) * 0.08 * dpr,
      vy: (Math.random() - 0.5) * 0.08 * dpr,
      phase: Math.random() * Math.PI * 2,
      tw: Math.random() * 0.02 + 0.005,
      base: Math.random() * 0.5 + 0.3,
    });

    const resize = () => {
      rgb = effectRgb(light);
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      const count = Math.min(170, Math.floor((window.innerWidth * window.innerHeight) / 8500));
      stars = Array.from({ length: count }, star);

      const cCount = Math.max(3, Math.min(6, Math.floor(window.innerWidth / 420)));
      constellations = Array.from({ length: cCount }, () => {
        const spread = (80 + Math.random() * 70) * dpr;
        const cx = spread + Math.random() * (w - 2 * spread);
        const cy = spread + Math.random() * (h - 2 * spread);
        const n = 4 + Math.floor(Math.random() * 4); // 4–7 nodes
        const nodes: Node[] = Array.from({ length: n }, () => ({
          x: cx + (Math.random() - 0.5) * 2 * spread,
          y: cy + (Math.random() - 0.5) * 2 * spread,
          r: (Math.random() * 1.2 + 1) * dpr,
          vx: (Math.random() - 0.5) * 0.06 * dpr,
          vy: (Math.random() - 0.5) * 0.06 * dpr,
        }));
        return {
          nodes,
          box: { x0: cx - spread, y0: cy - spread, x1: cx + spread, y1: cy + spread },
          link2: (spread * 1.05) ** 2,
        };
      });
      if (reduced) drawFrame(true);
    };

    const drawFrame = (still: boolean) => {
      ctx.clearRect(0, 0, w, h);

      // Loose stars (drift + twinkle, wrapping at the edges).
      for (const s of stars) {
        if (!still) {
          s.x += s.vx;
          s.y += s.vy;
          s.phase += s.tw;
          if (s.x < -2) s.x = w + 2;
          else if (s.x > w + 2) s.x = -2;
          if (s.y < -2) s.y = h + 2;
          else if (s.y > h + 2) s.y = -2;
        }
        const a = s.base * peak * (0.5 + 0.5 * Math.sin(s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb}, ${a})`;
        ctx.fill();
      }

      // Constellations: links first, then the brighter nodes.
      for (const c of constellations) {
        if (!still) {
          for (const n of c.nodes) {
            n.x += n.vx;
            n.y += n.vy;
            if (n.x < c.box.x0 || n.x > c.box.x1) n.vx *= -1;
            if (n.y < c.box.y0 || n.y > c.box.y1) n.vy *= -1;
          }
        }
        for (let i = 0; i < c.nodes.length; i++) {
          for (let j = i + 1; j < c.nodes.length; j++) {
            const a = c.nodes[i];
            const bn = c.nodes[j];
            const dx = a.x - bn.x;
            const dy = a.y - bn.y;
            const dist2 = dx * dx + dy * dy;
            if (dist2 > c.link2) continue;
            const t = 1 - dist2 / c.link2;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(bn.x, bn.y);
            ctx.strokeStyle = `rgba(${rgb}, ${linkAlpha * t})`;
            ctx.lineWidth = dpr * 0.6;
            ctx.stroke();
          }
        }
        for (const n of c.nodes) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${rgb}, ${nodeAlpha})`;
          ctx.fill();
        }
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
