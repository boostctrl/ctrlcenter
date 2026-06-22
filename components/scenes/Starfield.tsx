"use client";

import { useEffect, useRef } from "react";
import type { SceneProps } from "./index";

// Read a #rrggbb CSS var as an "r, g, b" string for canvas fills; falls back to
// a soft blue so the stars are always visible even mid-theme-edit.
function readAccentRgb(): string {
  const fallback = "150, 180, 240";
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent-from")
    .trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(v);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// Starfield — twinkling, slowly drifting stars on a canvas. Dark = a night sky;
// light = pale drifting motes (lower opacity). Recolors from the accent var; a
// single static frame is drawn under prefers-reduced-motion.
export default function Starfield({ light }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = window.devicePixelRatio || 1;
    const peak = light ? 0.45 : 0.9;
    let w = 0;
    let h = 0;
    let rgb = readAccentRgb();
    let stars: {
      x: number;
      y: number;
      r: number;
      vx: number;
      vy: number;
      phase: number;
      tw: number;
      base: number;
    }[] = [];
    let raf = 0;

    const spawn = () => ({
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
      rgb = readAccentRgb();
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      const count = Math.min(160, Math.floor((window.innerWidth * window.innerHeight) / 9000));
      stars = Array.from({ length: count }, spawn);
      if (reduced) drawStatic();
    };

    const paint = (s: (typeof stars)[number], a: number) => {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb}, ${a})`;
      ctx.fill();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        s.x += s.vx;
        s.y += s.vy;
        s.phase += s.tw;
        if (s.x < -2) s.x = w + 2;
        else if (s.x > w + 2) s.x = -2;
        if (s.y < -2) s.y = h + 2;
        else if (s.y > h + 2) s.y = -2;
        const a = s.base * peak * (0.5 + 0.5 * Math.sin(s.phase));
        paint(s, a);
      }
      raf = requestAnimationFrame(draw);
    };

    const drawStatic = () => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) paint(s, s.base * peak);
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
