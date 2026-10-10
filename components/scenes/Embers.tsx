"use client";

import { useEffect, useRef } from "react";
import type { SceneProps } from "./index";
import { effectRgbFor } from "./color";

// Embers — sparks lifting off the bottom edge of the page: they rise with a
// slow sideways wander, cool from the first accent tone into the second as
// they climb, shrink, and fade out on the way up, each flickering gently
// (well under 2 Hz). Distinct from Fireflies (hovering, pulsing fully on and
// off) and Snow (falling): embers are born at the base, climb and die. Every
// spark is one soft halo stamped from a sprite sheet pre-rendered in
// resize() — two cells, one per accent stop — so a frame is a few dozen
// drawImage calls with no gradient built per spark. A faint firelight glow
// along the base (plain CSS, never changing) anchors where they come from.
// Under reduced motion a plume already in flight is drawn once: sparks
// scattered up the page, older and fainter the higher they sit.
export default function Embers({ light, motion }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // The halo sprite sheet: a bright core inside a wide soft glow, painted
    // once per layout instead of a radial gradient per spark per frame.
    const sheet = document.createElement("canvas");
    const sctx = sheet.getContext("2d");
    if (!sctx) return;

    const reduced =
      motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Calm motion: advance every other frame — half speed, half the work.
    const calm = motion === "calm";
    let tick = 0;
    const dpr = window.devicePixelRatio || 1;
    // Sparks sit under the 40% page wash on light surfaces, so they peak
    // higher there; on dark a lower peak keeps the swarm from reading as
    // confetti against the near-black page.
    const peak = light ? 0.8 : 0.75;
    // Sprite cell edge in device px. Sparks are always drawn smaller than
    // this, so the halo only ever downsamples and stays smooth.
    const cell = Math.ceil(32 * dpr);
    let w = 0;
    let h = 0;
    let colors: [string, string] = ["150, 180, 240", "150, 180, 240"];
    let raf = 0;

    type Spark = {
      x: number;
      y: number;
      r: number; // halo radius at birth; it shrinks as the spark cools
      rise: number; // vertical speed
      sway: number; // lateral wander amplitude
      phase: number; // wander phase
      wobble: number; // wander speed
      life: number; // 0→1 from birth to burn-out: drives fade, colour, size
      step: number; // life per frame
      flick: number; // flicker phase
      rate: number; // flicker speed, radians per frame
      depth: number; // how far the flicker dips
      glow: number; // per-spark brightness, so the field has some variety
    };
    let sparks: Spark[] = [];

    // Re-seeds a spark in place (no allocation on respawn). fromBelow starts
    // it just under the bottom edge so it enters without a pop; otherwise —
    // the initial field and the still frame — it lands somewhere up the
    // page, denser near the base, with an age that matches its height, like
    // a plume already in flight.
    const seed = (s: Spark, fromBelow: boolean): Spark => {
      const y = fromBelow ? h + 8 * dpr : h * (1 - Math.random() ** 1.5);
      s.x = Math.random() * w;
      s.y = y;
      s.r = (7 + Math.random() * 9) * dpr;
      s.rise = (0.35 + Math.random() * 0.55) * dpr;
      s.sway = (0.15 + Math.random() * 0.4) * dpr;
      s.phase = Math.random() * Math.PI * 2;
      s.wobble = 0.01 + Math.random() * 0.025;
      s.life = fromBelow
        ? 0
        : Math.min(0.95, Math.max(0, 0.05 + (1 - y / h) * 0.85 + (Math.random() - 0.5) * 0.3));
      // 6–12 s of flight at 60 fps: the slow risers stay low, the quick ones
      // reach the top third before they go out.
      s.step = 1 / (360 + Math.random() * 360);
      s.flick = Math.random() * Math.PI * 2;
      // 0.3–0.8 Hz at 60 fps; still under 2 Hz on a 120 Hz display.
      s.rate = 0.03 + Math.random() * 0.05;
      s.depth = 0.2 + Math.random() * 0.3;
      s.glow = 0.7 + Math.random() * 0.3;
      return s;
    };
    const spawn = (): Spark =>
      seed(
        {
          x: 0,
          y: 0,
          r: 0,
          rise: 0,
          sway: 0,
          phase: 0,
          wobble: 0,
          life: 0,
          step: 0,
          flick: 0,
          rate: 0,
          depth: 0,
          glow: 0,
        },
        false
      );

    const resize = () => {
      colors = [effectRgbFor(light, "--accent-from"), effectRgbFor(light, "--accent-to")];
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      // One halo per accent stop. The core is a hot point at the centre; the
      // glow falls off fast then trails out, so a spark reads as a point of
      // light with a bloom rather than a soft blob.
      sheet.width = cell * 2;
      sheet.height = cell;
      colors.forEach((c, i) => {
        const cx = cell * i + cell / 2;
        const g = sctx.createRadialGradient(cx, cell / 2, 0, cx, cell / 2, cell / 2);
        g.addColorStop(0, `rgba(${c}, 1)`);
        g.addColorStop(0.2, `rgba(${c}, 0.9)`);
        g.addColorStop(0.4, `rgba(${c}, 0.35)`);
        g.addColorStop(0.68, `rgba(${c}, 0.1)`);
        g.addColorStop(1, `rgba(${c}, 0)`);
        sctx.fillStyle = g;
        sctx.fillRect(cell * i, 0, cell, cell);
      });
      const count = Math.max(20, Math.min(70, Math.floor(window.innerWidth / 18)));
      sparks = Array.from({ length: count }, spawn);
      if (reduced) drawFrame(true);
    };

    const drawFrame = (still: boolean) => {
      ctx.clearRect(0, 0, w, h);
      const m = 24 * dpr;
      for (const s of sparks) {
        if (!still) {
          s.phase += s.wobble;
          s.flick += s.rate;
          s.x += Math.sin(s.phase) * s.sway;
          s.y -= s.rise;
          s.life += s.step;
          if (s.life >= 1 || s.y < -m) seed(s, true);
          if (s.x < -m) s.x = w + m;
          else if (s.x > w + m) s.x = -m;
        }
        // Quick fade-in at birth, then a long fade over the second half of
        // the flight, so the plume thins out with height instead of sparks
        // blinking out at a line.
        const fade = Math.min(1, s.life / 0.12) * Math.min(1, (1 - s.life) / 0.45);
        const flicker = 1 - s.depth * (0.5 + 0.5 * Math.sin(s.flick));
        const a = peak * s.glow * fade * flicker;
        if (a < 0.01) continue;
        const r = s.r * (1 - 0.5 * s.life);
        const d = r * 2;
        // Cooling: the first stop at birth, cross-fading to the second by
        // two thirds of the flight. Two stamps of the same halo at
        // complementary alphas, each skipped once it is too faint to see.
        const cool = Math.min(1, s.life / 0.66);
        const hot = a * (1 - cool);
        const cold = a * cool;
        if (hot > 0.01) {
          ctx.globalAlpha = hot;
          ctx.drawImage(sheet, 0, 0, cell, cell, s.x - r, s.y - r, d, d);
        }
        if (cold > 0.01) {
          ctx.globalAlpha = cold;
          ctx.drawImage(sheet, cell, 0, cell, cell, s.x - r, s.y - r, d, d);
        }
      }
      ctx.globalAlpha = 1;
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
      {/* Firelight along the base: the source the sparks lift off from. The
          resolver's --scene-from is already deepened for light surfaces; the
          wash above dims it there, hence the slightly higher mix. */}
      <div
        className="absolute inset-x-0 bottom-0 h-2/5"
        style={{
          background: `linear-gradient(to top, color-mix(in srgb, var(--scene-from) ${light ? 16 : 18}%, transparent), transparent)`,
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
