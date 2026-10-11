"use client";

import { useEffect, useRef } from "react";
import type { SceneProps } from "./index";
import { effectRgbFor } from "./color";

// Snow — round flakes falling in three depth bands: the far band is a slow,
// faint sheet of small dots, the near band a few larger, brighter flakes that
// visibly wander, and the middle sits between. A shared gust leans the whole
// fall one way, then the other, over tens of seconds, and every flake flutters
// sideways on its own. Lifted from the weather widget's snow
// (components/WeatherEffects.tsx) and recoloured from the accent pair. Plain
// arcs only, batched per band and accent stop, so a frame is six fills rather
// than a hundred. Distinct from Petals (shaped, turning) and Rain (streaks at
// one fixed angle). A scattered mid-fall field is drawn under reduced motion.
export default function Snow({ light, motion }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Calm motion: advance every other frame — half speed, half the work.
    const calm = motion === "calm";
    let tick = 0;
    const dpr = window.devicePixelRatio || 1;
    // Frames drawn so far: the clock the gust runs on. Counting drawn frames
    // rather than wall time is what slows the gust under calm along with the
    // fall, so the field still moves as one.
    let t = 0;
    let w = 0;
    let h = 0;
    let raf = 0;

    // The three depth bands, far to near. Size, fall speed and alpha rise
    // together, which is what sells the depth, and the flutter grows with
    // them: near flakes visibly wander, the far sheet barely stirs, which
    // reads as air resistance at scale. `share` is each band's slice of the
    // field, weighted to the back so the front stays a few big flakes. Light
    // surfaces get +0.1 under the 40% page wash.
    const lift = light ? 0.1 : 0;
    type Band = { r: number; fall: number; alpha: number; flutter: number; share: number };
    const BANDS: Band[] = [
      { r: 1.1, fall: 0.34, alpha: 0.3 + lift, flutter: 0.12, share: 0.5 },
      { r: 1.9, fall: 0.6, alpha: 0.5 + lift, flutter: 0.22, share: 0.3 },
      { r: 2.9, fall: 1, alpha: 0.7 + lift, flutter: 0.36, share: 0.2 },
    ];

    type Flake = {
      x: number;
      y: number;
      r: number;
      fall: number; // vertical speed per frame
      amp: number; // flutter amplitude
      freq: number; // flutter rate, radians per frame
      phase: number;
    };
    // One group per band and accent stop: the flakes that share a fill
    // style, drawn as one path. Rebuilt only on resize.
    type Group = { style: string; band: Band; flakes: Flake[] };
    let groups: Group[] = [];

    // Re-seeds a flake in place (no allocation per respawn). `anywhereY`
    // scatters the initial field across the screen; a respawn enters just
    // above the top so there's no pop-in. Size and speed vary together
    // within a band, so the bigger flake of two is also the quicker one.
    const seed = (f: Flake, band: Band, anywhereY: boolean) => {
      const v = 0.8 + Math.random() * 0.5;
      f.r = band.r * v * dpr;
      f.fall = band.fall * v * dpr;
      f.amp = band.flutter * dpr;
      f.freq = 0.02 + Math.random() * 0.025;
      f.phase = Math.random() * Math.PI * 2;
      f.x = Math.random() * w;
      f.y = anywhereY ? Math.random() * h : -f.r;
    };

    // The wind: a shared lean (horizontal drift per unit of fall) that swings
    // from one side to the other over tens of seconds, so the whole field
    // sways as one weather system instead of falling at a fixed angle. Two
    // incommensurate sines (periods of ~25 s and ~9 s at 60 Hz) keep the
    // gusts irregular. The still frame reads it at t = 0: a slight lean.
    const gustAt = (tt: number) =>
      0.05 + 0.16 * Math.sin(tt * 0.0042) + 0.06 * Math.sin(tt * 0.0117 + 1.7);

    const resize = () => {
      const colors = [effectRgbFor(light, "--accent-from"), effectRgbFor(light, "--accent-to")];
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      const count = Math.max(24, Math.min(110, Math.floor(window.innerWidth / 10)));
      groups = [];
      for (const band of BANDS) {
        colors.forEach((rgb, c) => {
          // Most flakes take the first accent stop; the second salts the field.
          const n = Math.round(count * band.share * (c === 0 ? 0.65 : 0.35));
          const flakes = Array.from({ length: n }, () => {
            const f: Flake = { x: 0, y: 0, r: 0, fall: 0, amp: 0, freq: 0, phase: 0 };
            seed(f, band, true);
            return f;
          });
          groups.push({ style: `rgba(${rgb}, ${band.alpha})`, band, flakes });
        });
      }
      if (reduced) drawFrame(true);
    };

    const drawFrame = (still: boolean) => {
      ctx.clearRect(0, 0, w, h);
      const gust = still ? gustAt(0) : gustAt(t);
      const m = 6 * dpr;
      for (const g of groups) {
        ctx.fillStyle = g.style;
        ctx.beginPath();
        for (const f of g.flakes) {
          if (!still) {
            f.phase += f.freq;
            f.y += f.fall;
            // Per-flake flutter plus the shared gust, scaled by the fall so
            // the quick near flakes lean furthest.
            f.x += Math.sin(f.phase) * f.amp + f.fall * gust;
            if (f.y - f.r > h) seed(f, g.band, false);
            // The gust carries flakes off one edge; they come back on the other.
            if (f.x < -m) f.x = w + m;
            else if (f.x > w + m) f.x = -m;
          }
          // moveTo first: arc() would otherwise join each flake to the last
          // and the fill would bridge the span between them.
          ctx.moveTo(f.x + f.r, f.y);
          ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      if (!still) t++;
    };

    const draw = () => {
      if (calm && (tick++ & 1)) {
        raf = requestAnimationFrame(draw);
        return;
      }
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
  }, [light, motion]);

  return (
    <div aria-hidden className="scene-root pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
