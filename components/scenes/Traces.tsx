"use client";

import { useEffect, useRef } from "react";
import type { SceneProps } from "./index";
import { effectRgb } from "./color";

// Traces — a motherboard / PCB backdrop: grid-snapped orthogonal traces with
// pads at their ends, and a few bright "signal" pulses travelling along them like
// current. Faint accent on dark; blended toward the ink on light (effectRgb). A
// static frame (traces + pads, no pulses) under prefers-reduced-motion.
type Pt = { x: number; y: number };
type Seg = { x: number; y: number; dx: number; dy: number; len: number };
type Trace = { pts: Pt[]; segs: Seg[]; total: number };

function buildSegs(pts: Pt[]): { segs: Seg[]; total: number } {
  const segs: Seg[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    segs.push({ x: a.x, y: a.y, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len, len });
    total += len;
  }
  return { segs, total };
}

function pointAt(t: Trace, d: number): Pt {
  let rem = ((d % t.total) + t.total) % t.total;
  for (const s of t.segs) {
    if (rem <= s.len) return { x: s.x + s.dx * rem, y: s.y + s.dy * rem };
    rem -= s.len;
  }
  const last = t.pts[t.pts.length - 1];
  return { x: last.x, y: last.y };
}

export default function Traces({ light }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = window.devicePixelRatio || 1;
    const traceAlpha = light ? 0.28 : 0.22;
    const padAlpha = light ? 0.5 : 0.45;
    let w = 0;
    let h = 0;
    let rgb = effectRgb(light);
    let traces: Trace[] = [];
    let pulses: { ti: number; d: number; speed: number }[] = [];
    let raf = 0;

    const makeTrace = (cell: number, cols: number, rows: number): Trace | null => {
      let cx = Math.floor(Math.random() * (cols + 1));
      let cy = Math.floor(Math.random() * (rows + 1));
      const pts: Pt[] = [{ x: cx * cell, y: cy * cell }];
      let horizontal = Math.random() < 0.5;
      const segs = 4 + Math.floor(Math.random() * 7);
      for (let i = 0; i < segs; i++) {
        const step = 1 + Math.floor(Math.random() * 3);
        if (horizontal) cx = Math.max(0, Math.min(cols, cx + (Math.random() < 0.5 ? step : -step)));
        else cy = Math.max(0, Math.min(rows, cy + (Math.random() < 0.5 ? step : -step)));
        const last = pts[pts.length - 1];
        const nx = cx * cell;
        const ny = cy * cell;
        if (nx !== last.x || ny !== last.y) pts.push({ x: nx, y: ny });
        horizontal = !horizontal;
      }
      if (pts.length < 2) return null;
      const { segs: s, total } = buildSegs(pts);
      if (total === 0) return null;
      return { pts, segs: s, total };
    };

    const resize = () => {
      rgb = effectRgb(light);
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      const cell = 34 * dpr;
      const cols = Math.floor(w / cell);
      const rows = Math.floor(h / cell);
      const count = Math.min(46, Math.floor((window.innerWidth * window.innerHeight) / 26000));
      traces = [];
      for (let i = 0; i < count; i++) {
        const t = makeTrace(cell, cols, rows);
        if (t) traces.push(t);
      }
      const pCount = Math.min(12, Math.max(4, Math.floor(traces.length / 4)));
      pulses = Array.from({ length: pCount }, () => ({
        ti: Math.floor(Math.random() * traces.length),
        d: Math.random() * 9999,
        speed: (0.6 + Math.random() * 1.1) * dpr,
      }));
      if (reduced) drawFrame(true);
    };

    const drawFrame = (still: boolean) => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Faint traces + pads at their endpoints.
      ctx.lineWidth = dpr * 1.1;
      ctx.strokeStyle = `rgba(${rgb}, ${traceAlpha})`;
      for (const t of traces) {
        ctx.beginPath();
        ctx.moveTo(t.pts[0].x, t.pts[0].y);
        for (let i = 1; i < t.pts.length; i++) ctx.lineTo(t.pts[i].x, t.pts[i].y);
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(${rgb}, ${padAlpha})`;
      for (const t of traces) {
        for (const p of [t.pts[0], t.pts[t.pts.length - 1]]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, dpr * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Travelling signal pulses (bright, glowing).
      if (traces.length > 0) {
        ctx.shadowColor = `rgba(${rgb}, 0.9)`;
        ctx.shadowBlur = dpr * 6;
        for (const pu of pulses) {
          if (!still) pu.d += pu.speed;
          const t = traces[pu.ti] ?? traces[0];
          const p = pointAt(t, pu.d);
          ctx.beginPath();
          ctx.arc(p.x, p.y, dpr * 1.8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${rgb}, 0.95)`;
          ctx.fill();
        }
        ctx.shadowBlur = 0;
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
