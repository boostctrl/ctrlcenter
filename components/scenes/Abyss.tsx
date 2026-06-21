"use client";

import { useEffect, useRef } from "react";

// Abyss — a deep-sea scene: a bioluminescent halo + depth tint layered over the
// page background, drifting "marine snow" on a canvas, and a depth-gauge
// ornament. Everything is built from the accent / background CSS vars so it
// recolors with the active palette, and all motion is disabled under
// prefers-reduced-motion. Ported from the reference 404 page.

// Read a #rrggbb CSS var as an "r, g, b" string for canvas fills; falls back to
// a teal so the snow is always visible even mid-theme-edit.
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

export function AbyssBackdrop() {
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
      a: Math.random() * 0.4 + 0.1,
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
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      {/* Bioluminescent depth tint, layered over the page background. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% -10%, color-mix(in srgb, var(--accent-from) 12%, transparent) 0%, color-mix(in srgb, var(--accent-from) 3%, transparent) 24%, transparent 50%)," +
            "radial-gradient(140% 120% at 50% 120%, color-mix(in srgb, var(--accent-from) 16%, transparent) 0%, transparent 70%)",
        }}
      />
      {/* The breathing halo behind where the content sits. */}
      <div
        className="animate-breathe absolute left-1/2 top-[38%] h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-md"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--accent-from) 18%, transparent) 0%, color-mix(in srgb, var(--accent-from) 5%, transparent) 38%, transparent 66%)",
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

// The depth gauge — Abyss's signature ornament. A hairline rail with depth ticks
// and a glowing "you are here" marker, pinned to the left margin. Decorative
// only: behind content, non-interactive, and hidden on narrow screens.
export function AbyssOrnament() {
  const ticks = [
    { top: "0%", label: "0 m — surface" },
    { top: "25%", label: "100 m" },
    { top: "50%", label: "200 m" },
    { top: "75%", label: "300 m" },
  ];
  return (
    <aside
      aria-hidden
      className="pointer-events-none fixed top-1/2 -z-10 hidden -translate-y-1/2 md:block"
      style={{
        left: "clamp(18px, 5vw, 56px)",
        height: "min(62vh, 460px)",
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
      }}
    >
      <div
        className="relative ml-3.5 h-full w-px"
        style={{
          background:
            "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--accent-from) 16%, transparent) 12%, color-mix(in srgb, var(--accent-from) 16%, transparent) 88%, transparent)",
        }}
      >
        {ticks.map((t) => (
          <div
            key={t.top}
            className="absolute left-0 h-px w-2.5"
            style={{
              top: t.top,
              background: "color-mix(in srgb, var(--accent-from) 16%, transparent)",
            }}
          >
            <span
              className="absolute left-4 whitespace-nowrap text-[10px] tracking-wider"
              style={{
                top: "-7px",
                color: "color-mix(in srgb, var(--foreground) 45%, transparent)",
              }}
            >
              {t.label}
            </span>
          </div>
        ))}
        <div
          className="absolute h-2.5 w-2.5 rounded-full"
          style={{
            left: "-4px",
            bottom: "4%",
            background: "var(--accent-from)",
            boxShadow:
              "0 0 14px 2px color-mix(in srgb, var(--accent-from) 55%, transparent)",
          }}
        >
          <span
            className="absolute whitespace-nowrap text-[10px] uppercase tracking-widest"
            style={{ left: "18px", top: "-5px", color: "var(--accent-from)" }}
          >
            you are here
          </span>
        </div>
      </div>
    </aside>
  );
}
