"use client";

import { useEffect, useRef } from "react";
import type { SceneProps } from "./index";
import { effectRgbFor } from "./color";

// Comets — sparse shooting stars: bright heads with long fading tails that
// streak diagonally across the sky in both accent tones, only a few at a
// time. Distinct from Rain (dense, uniform, slow) and Starfield (stationary
// twinkle): comets are rare, fast and directional. A pair of frozen streaks
// is drawn under prefers-reduced-motion.
export default function Comets({ light }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = window.devicePixelRatio || 1;
    const peak = light ? 0.8 : 0.9;
    let w = 0;
    let h = 0;
    let colors: [string, string] = ["150, 180, 240", "150, 180, 240"];
    let raf = 0;

    type Comet = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      tail: number; // tail length in px
      life: number; // 0→1 over the flight, drives fade-in/out
      step: number; // life per frame
      c: number;
    };
    let comets: Comet[] = [];

    const spawn = (): Comet => {
      // Enter from the top edge (or just off the right corner) heading
      // down-left at a shallow angle, like a meteor shower with one radiant.
      const angle = Math.PI * (0.72 + Math.random() * 0.1); // ~130–148°
      const speed = (5 + Math.random() * 6) * dpr;
      return {
        x: (0.15 + Math.random() * 1.05) * w,
        y: -20 * dpr,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        tail: (90 + Math.random() * 110) * dpr,
        life: 0,
        step: 0.004 + Math.random() * 0.004,
        c: Math.random() < 0.65 ? 0 : 1,
      };
    };

    const drawComet = (k: Comet, a: number) => {
      const tx = k.x - (k.vx / Math.hypot(k.vx, k.vy)) * k.tail;
      const ty = k.y - (k.vy / Math.hypot(k.vx, k.vy)) * k.tail;
      const grad = ctx.createLinearGradient(k.x, k.y, tx, ty);
      grad.addColorStop(0, `rgba(${colors[k.c]}, ${a})`);
      grad.addColorStop(1, `rgba(${colors[k.c]}, 0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2 * dpr;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(k.x, k.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      // A soft glow at the head.
      const halo = 5 * dpr;
      const hg = ctx.createRadialGradient(k.x, k.y, 0, k.x, k.y, halo);
      hg.addColorStop(0, `rgba(${colors[k.c]}, ${a})`);
      hg.addColorStop(1, `rgba(${colors[k.c]}, 0)`);
      ctx.beginPath();
      ctx.arc(k.x, k.y, halo, 0, Math.PI * 2);
      ctx.fillStyle = hg;
      ctx.fill();
    };

    const resize = () => {
      colors = [effectRgbFor(light, "--accent-from"), effectRgbFor(light, "--accent-to")];
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      if (reduced) {
        // Two frozen streaks mid-flight, so the scene still reads as comets.
        ctx.clearRect(0, 0, w, h);
        const a = { ...spawn(), x: w * 0.62, y: h * 0.24, c: 0 };
        const b = { ...spawn(), x: w * 0.3, y: h * 0.55, c: 1 };
        drawComet(a, peak * 0.7);
        drawComet(b, peak * 0.5);
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      // Sparse: at most three in flight, spawned on random chance so showers
      // cluster naturally instead of ticking on a metronome.
      if (comets.length < 3 && Math.random() < 0.008) comets.push(spawn());
      const margin = 40 * dpr;
      comets = comets.filter(
        (k) => k.life < 1 && k.x > -k.tail - margin && k.y < h + k.tail + margin
      );
      for (const k of comets) {
        k.x += k.vx;
        k.y += k.vy;
        k.life += k.step;
        // Fade in fast, cruise, fade out at the end of life.
        const a =
          peak * Math.min(1, k.life / 0.08) * Math.min(1, (1 - k.life) / 0.25);
        if (a > 0.01) drawComet(k, a);
      }
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
