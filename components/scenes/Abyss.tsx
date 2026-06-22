"use client";

import { useEffect, useRef } from "react";
import type { SceneProps } from "./index";

// Abyss — a deep-sea scene. Dark = the trench: a bioluminescent halo + depth
// tint, drifting "marine snow", a depth-gauge ornament. Light = sunlit shallows:
// the same family re-themed — a bright wash from above, brighter drifting motes,
// deep-teal ink. Everything is built from the accent / background CSS vars so it
// recolors with the active palette, and all motion is disabled under
// prefers-reduced-motion. Ported from the reference 404 page.

// Read a #rrggbb CSS var as an "r, g, b" string for canvas fills; falls back to
// a teal so the motes are always visible even mid-theme-edit.
function readAccentRgb(): string {
  const fallback = "150, 230, 222";
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent-from")
    .trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(v);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export function AbyssBackdrop({ light }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const dpr = window.devicePixelRatio || 1;
    let w = 0;
    let h = 0;
    let rgb = readAccentRgb();
    let particles: {
      x: number;
      y: number;
      r: number;
      vy: number;
      drift: number;
      phase: number;
      a: number;
    }[] = [];
    let raf = 0;

    const spawn = () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: (Math.random() * 1.6 + 0.4) * dpr,
      vy: (Math.random() * 0.25 + 0.08) * dpr,
      drift: Math.random() * 0.4 - 0.2,
      phase: Math.random() * Math.PI * 2,
      // Brighter, slightly denser motes in the shallows so they read on a pale
      // wash; fainter glints in the trench.
      a: light ? Math.random() * 0.3 + 0.15 : Math.random() * 0.4 + 0.1,
    });

    const resize = () => {
      rgb = readAccentRgb();
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      const count = Math.min(90, Math.floor(window.innerWidth / 14));
      particles = Array.from({ length: count }, spawn);
      if (reduced) drawStatic();
    };

    const paint = (p: (typeof particles)[number]) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb}, ${p.a})`;
      ctx.fill();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.y += p.vy;
        p.phase += 0.01;
        p.x += Math.sin(p.phase) * 0.3 + p.drift;
        if (p.y > h + 5) {
          p.y = -5;
          p.x = Math.random() * w;
        }
        paint(p);
      }
      raf = requestAnimationFrame(draw);
    };

    const drawStatic = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) paint(p);
    };

    resize();
    window.addEventListener("resize", resize);
    if (!reduced) draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, [light]);

  // Depth tint (trench) vs. a sunlight wash from above (shallows).
  const tint = light
    ? "radial-gradient(140% 80% at 50% -25%, color-mix(in srgb, var(--accent-from) 28%, transparent) 0%, color-mix(in srgb, var(--accent-from) 8%, transparent) 30%, transparent 58%)," +
      "radial-gradient(100% 70% at 50% 120%, color-mix(in srgb, var(--accent-from) 14%, transparent) 0%, transparent 72%)"
    : "radial-gradient(120% 90% at 50% -10%, color-mix(in srgb, var(--accent-from) 12%, transparent) 0%, color-mix(in srgb, var(--accent-from) 3%, transparent) 24%, transparent 50%)," +
      "radial-gradient(140% 120% at 50% 120%, color-mix(in srgb, var(--accent-from) 16%, transparent) 0%, transparent 70%)";
  const haloPct = light ? "24%" : "18%";

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <div className="absolute inset-0" style={{ background: tint }} />
      <div
        className="animate-breathe absolute left-1/2 top-[38%] h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-md"
        style={{
          background: `radial-gradient(circle, color-mix(in srgb, var(--accent-from) ${haloPct}, transparent) 0%, color-mix(in srgb, var(--accent-from) 5%, transparent) 38%, transparent 66%)`,
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
