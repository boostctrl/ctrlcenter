"use client";

import { useEffect, useRef } from "react";

// Animated condition effects for the weather-page hero card: layered rain with
// gusting wind and bottom-edge splashes, drifting snow, storm lightning,
// rolling fog, clouds lit from above, a warm sun glow with slow-turning rays,
// or twinkling moonlight — picked from the current WMO weather code and
// day/night flag. Draws on a card-sized canvas layered between the hero's
// condition wash and its text; colors are muted naturalistic tones tuned per
// surface (`light`) so they read on both the near-white and dark cards.
// Honours prefers-reduced-motion by rendering a single still frame, matching
// the backdrop scenes.
//
// Light direction (#160): every light source anchors to the TOP LEFT, where
// the hero's condition icon sits — the canvas paints beneath the text layer,
// so the sun/moon glow radiates out from behind the icon and the icon reads
// as being the source. Anything lit (cloud shading) takes its highlight from
// the same corner.

type EffectKind = "sun" | "stars" | "clouds" | "fog" | "rain" | "snow" | "storm";

// Map a WMO weather code (+ day flag) to an effect and a 0–1 intensity.
// Grouping mirrors weatherCodeLabel/weatherCodeToIcon in lib/weather.ts.
export function effectFor(
  code: number,
  isDay: boolean
): { kind: EffectKind; intensity: number } | null {
  if ([95, 96, 99].includes(code)) return { kind: "storm", intensity: 1 };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return { kind: "snow", intensity: code === 75 || code === 86 ? 1 : 0.65 };
  if (code >= 80 && code <= 82)
    return { kind: "rain", intensity: code === 82 ? 1 : 0.75 };
  if (code >= 61 && code <= 67)
    return { kind: "rain", intensity: code >= 65 ? 0.9 : code >= 63 ? 0.65 : 0.5 };
  if (code >= 51 && code <= 57) return { kind: "rain", intensity: 0.3 };
  if (code === 45 || code === 48) return { kind: "fog", intensity: 1 };
  if (code === 3) return { kind: "clouds", intensity: 1 };
  if (code === 2) return { kind: "clouds", intensity: 0.55 };
  if (code === 0 || code === 1)
    return isDay
      ? { kind: "sun", intensity: code === 0 ? 1 : 0.7 }
      : { kind: "stars", intensity: code === 0 ? 1 : 0.7 };
  return null;
}

// Naturalistic "r, g, b" tones per surface: cool grays and blues for
// precipitation and cloud, warm amber for sun. Darkened on the light surface
// so they contrast instead of washing out.
function palette(light: boolean) {
  return light
    ? {
        rain: "70, 100, 150",
        snow: "110, 130, 165",
        cloud: "105, 115, 135",
        fog: "115, 125, 145",
        sun: "225, 150, 40",
        star: "80, 95, 125",
        bolt: "70, 90, 140",
      }
    : {
        rain: "165, 190, 230",
        snow: "235, 242, 255",
        cloud: "195, 205, 228",
        fog: "205, 215, 235",
        sun: "255, 190, 90",
        star: "235, 240, 255",
        bolt: "245, 248, 255",
      };
}

// One raindrop / snowflake / star. `depth` (far 0 → near 1) scales size,
// speed, and alpha together, which is what sells the depth-of-field: the back
// of the field is a soft slow sheet, the front is a few sharp fast streaks.
// `lenF`/`speedF` add per-drop variation WITHIN a depth so a layer doesn't
// read as a uniform comb of identical strokes.
type Particle = {
  x: number;
  y: number;
  depth: number;
  phase: number;
  speed: number;
  lenF: number;
  speedF: number;
};

// A rain impact at the bottom edge: a small ring that expands and fades where
// a near-field drop landed, so drops visibly end somewhere instead of sliding
// off the card.
type Splash = { x: number; born: number; depth: number };

type Cloud = {
  x: number;
  y: number;
  scale: number;
  speed: number;
  alpha: number;
  puffs: { dx: number; dy: number; r: number }[];
};

export default function WeatherEffects({
  code,
  isDay,
  light,
}: {
  code: number;
  isDay: boolean;
  light: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const effect = effectFor(code, isDay);
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!effect || !host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { kind, intensity } = effect;
    const colors = palette(light);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = window.devicePixelRatio || 1;
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;
    let t = 0; // animation clock (ms), advances only while animating

    // Where the light lives: behind the hero's condition icon — 24px card
    // padding plus half the text-7xl emoji, clamped in for very small cards.
    // drawSun/drawStars radiate from here, and cloud shading highlights toward
    // it, so the icon in the text layer above reads as the source.
    const lightX = () => Math.min(62 * dpr, w * 0.18);
    const lightY = () => Math.min(60 * dpr, h * 0.45);

    // The wind: a shared, slowly-gusting slant (horizontal drift per unit of
    // fall) so all precipitation sways as one weather system instead of
    // falling at a fixed angle. Two incommensurate sines make the gusts feel
    // irregular; storms swing harder via `amp`. A still frame reads it at
    // t = 0 — a fixed, believable lean.
    const gustAmp = kind === "storm" ? 1.6 : 1;
    const slantAt = (tt: number) =>
      0.13 +
      gustAmp * (0.09 * Math.sin(tt * 0.00033) + 0.05 * Math.sin(tt * 0.0011 + 1.7));

    let drops: Particle[] = [];
    let flakes: Particle[] = [];
    let clouds: Cloud[] = [];
    let stars: Particle[] = [];
    let splashes: Splash[] = [];
    const MAX_SPLASHES = 16;
    const SPLASH_MS = 340;
    // Lightning state: when the next strike fires, and the current bolt.
    let strikeAt = 2000 + Math.random() * 4000;
    let bolt: { points: [number, number][]; born: number } | null = null;

    const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

    const spawnDrop = (): Particle => ({
      // The gust swings both ways, so seed beyond both side edges.
      x: rand(-h * 0.3, w + h * 0.3),
      y: rand(0, h),
      depth: Math.random(),
      phase: 0,
      speed: 0,
      lenF: rand(0.7, 1.35),
      speedF: rand(0.85, 1.2),
    });

    const spawnFlake = (): Particle => ({
      x: rand(0, w),
      y: rand(0, h),
      depth: Math.random(),
      phase: rand(0, Math.PI * 2),
      speed: rand(0.5, 1.4),
      lenF: 1,
      speedF: 1,
    });

    const spawnCloud = (i: number, count: number): Cloud => {
      const scale = rand(0.7, 1.15) * (0.6 + 0.4 * intensity);
      return {
        // Stagger starting positions across (and beyond) the card so the sky
        // doesn't pop in empty, then drift and wrap.
        x: (w * (i + rand(0.1, 0.6))) / count,
        y: h * rand(0.08, 0.45),
        scale,
        speed: rand(0.006, 0.016) * (2 - scale), // far/small clouds drift slower
        alpha: rand(0.5, 0.9),
        puffs: Array.from({ length: 4 }, (_, p) => ({
          dx: (p - 1.5) * rand(28, 40),
          dy: rand(-12, 10),
          r: rand(26, 44),
        })),
      };
    };

    const makeBolt = (): [number, number][] => {
      const points: [number, number][] = [];
      let x = rand(w * 0.25, w * 0.8);
      let y = -4 * dpr;
      points.push([x, y]);
      while (y < h * 0.7) {
        x += rand(-1, 1) * w * 0.035;
        y += rand(0.6, 1.2) * h * 0.12;
        points.push([x, y]);
      }
      return points;
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      w = canvas.width = Math.max(1, Math.round(rect.width * dpr));
      h = canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const cssW = rect.width;
      drops = flakes = stars = [];
      clouds = [];
      splashes = [];
      if (kind === "rain" || kind === "storm") {
        const count = Math.min(170, Math.round((cssW / 5.5) * intensity));
        drops = Array.from({ length: count }, spawnDrop);
      } else if (kind === "snow") {
        const count = Math.min(110, Math.round((cssW / 8) * intensity));
        flakes = Array.from({ length: count }, spawnFlake);
      } else if (kind === "clouds") {
        const count = Math.max(2, Math.round((2 + cssW / 260) * intensity));
        clouds = Array.from({ length: count }, (_, i) => spawnCloud(i, count));
      } else if (kind === "stars") {
        const count = Math.min(90, Math.round((cssW / 9) * intensity));
        stars = Array.from({ length: count }, () => ({
          x: rand(0, w),
          y: rand(0, h * 0.9),
          depth: Math.random(),
          phase: rand(0, Math.PI * 2),
          speed: rand(0.0006, 0.002),
          lenF: 1,
          speedF: 1,
        }));
      }
      if (reduced) drawFrame(0, true);
    };

    // Rain with a depth of field: depth scales length, fall speed, weight and
    // alpha together (far drops are a soft slow sheet, near ones are sharp
    // fast streaks), per-drop lenF/speedF break up uniformity, and the shared
    // gust sways the whole field. A near drop that reaches the bottom edge
    // lands as a splash ring rather than sliding off.
    const drawRain = (dt: number, still: boolean, heavy: boolean) => {
      const slant = still ? slantAt(0) : slantAt(t);
      ctx.lineCap = "round";
      for (const d of drops) {
        const len =
          (heavy ? 15 : 10) * (0.55 + d.depth * 1.9) * d.lenF * dpr;
        if (!still) {
          const vy =
            (1.7 + d.depth * (heavy ? 5.2 : 3.6)) * d.speedF * dpr * (dt / 16);
          d.y += vy;
          d.x += vy * slant;
          if (d.y - len > h) {
            // Only the near field is close enough for its impact to read;
            // drizzle is too fine to splash at all.
            if (!still && d.depth > 0.55 && intensity >= 0.45) {
              splashes.push({ x: d.x, born: t, depth: d.depth });
              if (splashes.length > MAX_SPLASHES) splashes.shift();
            }
            Object.assign(d, spawnDrop(), { y: -len });
          }
        }
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - len * slant, d.y - len);
        ctx.lineWidth = (0.6 + d.depth * 0.9) * dpr;
        ctx.strokeStyle = `rgba(${colors.rain}, ${0.1 + d.depth * 0.32})`;
        ctx.stroke();
      }
      if (!still) drawSplashes();
    };

    // Expanding, fading impact rings pinned to the bottom edge — squashed
    // ellipses so they read as rings on the ground plane seen edge-on.
    const drawSplashes = () => {
      const y = h - 2 * dpr;
      splashes = splashes.filter((s) => t - s.born <= SPLASH_MS);
      for (const s of splashes) {
        const p = (t - s.born) / SPLASH_MS;
        const rx = (1.5 + p * 9 * (0.5 + s.depth * 0.7)) * dpr;
        ctx.beginPath();
        ctx.ellipse(s.x, y, rx, rx * 0.32, 0, 0, Math.PI * 2);
        ctx.lineWidth = 0.9 * dpr;
        ctx.strokeStyle = `rgba(${colors.rain}, ${(1 - p) * 0.5 * (0.4 + s.depth * 0.6)})`;
        ctx.stroke();
      }
    };

    const drawSnow = (dt: number, still: boolean) => {
      const slant = still ? slantAt(0) : slantAt(t);
      for (const f of flakes) {
        const r = (0.8 + f.depth * 1.8) * dpr;
        if (!still) {
          const vy = (0.25 + f.depth * 0.55) * f.speed * dpr * (dt / 16);
          f.y += vy;
          // Per-flake flutter plus a fraction of the shared gust, so the snow
          // and any storm on the next refresh lean the same way.
          f.x +=
            Math.sin(t * 0.0012 * f.speed + f.phase) * 0.25 * dpr * (dt / 16) +
            vy * slant * 0.6;
          if (f.y - r > h) {
            Object.assign(f, spawnFlake(), { y: -r });
          }
        }
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colors.snow}, ${0.25 + f.depth * 0.5})`;
        ctx.fill();
      }
    };

    // Clouds are lit from the top left like everything else: each puff's
    // gradient centers toward the light anchor, so the up-light side glows
    // and the far side falls off — round volumes instead of flat blobs.
    const drawClouds = (dt: number, still: boolean) => {
      for (const c of clouds) {
        const width = 120 * c.scale * dpr;
        if (!still) {
          c.x += c.speed * dpr * dt;
          if (c.x - width * 1.6 > w) c.x = -width * 1.6;
        }
        for (const p of c.puffs) {
          const r = p.r * c.scale * dpr;
          const px = c.x + p.dx * c.scale * dpr;
          const py = c.y + p.dy * c.scale * dpr;
          // Highlight offset: a fixed fraction of the puff radius toward the
          // light corner (direction is what matters, not exact geometry).
          const hx = px - r * 0.3;
          const hy = py - r * 0.3;
          const grad = ctx.createRadialGradient(hx, hy, 0, px, py, r * 1.1);
          grad.addColorStop(0, `rgba(${colors.cloud}, ${0.14 * c.alpha * intensity})`);
          grad.addColorStop(0.55, `rgba(${colors.cloud}, ${0.07 * c.alpha * intensity})`);
          grad.addColorStop(1, `rgba(${colors.cloud}, 0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(px, py, r * 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const drawFog = (still: boolean) => {
      // Three broad haze bands sliding in alternating directions; a still frame
      // just renders them where the clock stopped.
      for (let i = 0; i < 3; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        const drift = still ? 0 : (t * (0.008 + i * 0.004)) % (w * 2);
        const cx = ((w * (0.3 + i * 0.35) + dir * drift + w * 2) % (w * 2)) - w * 0.5;
        const cy = h * (0.3 + i * 0.28);
        const rx = w * 0.55;
        const ry = h * 0.26;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
        grad.addColorStop(0, `rgba(${colors.fog}, ${0.1 - i * 0.015})`);
        grad.addColorStop(1, `rgba(${colors.fog}, 0)`);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, ry / rx);
        ctx.translate(-cx, -cy);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };

    const drawSun = (still: boolean) => {
      // Warm glow breathing behind the hero's sun icon (top left), with slow
      // rays turning around it — the icon above the canvas IS the source.
      const cx = lightX();
      const cy = lightY();
      const breathe = still ? 1 : 1 + 0.05 * Math.sin(t * 0.0012);
      const r = Math.max(h * 0.95, w * 0.45) * breathe * intensity;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      glow.addColorStop(0, `rgba(${colors.sun}, ${0.3 * intensity})`);
      glow.addColorStop(0.45, `rgba(${colors.sun}, ${0.09 * intensity})`);
      glow.addColorStop(1, `rgba(${colors.sun}, 0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      const spin = still ? 0.4 : t * 0.00008;
      for (let i = 0; i < 6; i++) {
        const a = spin + (i * Math.PI) / 3;
        const len = Math.max(h * 1.2, w * 0.55);
        const grad = ctx.createLinearGradient(
          cx,
          cy,
          cx + Math.cos(a) * len,
          cy + Math.sin(a) * len
        );
        grad.addColorStop(0, `rgba(${colors.sun}, ${0.07 * intensity})`);
        grad.addColorStop(1, `rgba(${colors.sun}, 0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 26 * dpr;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        ctx.stroke();
      }
    };

    const drawStars = (still: boolean) => {
      // Soft moonlight behind the hero's moon icon (top left, same anchor as
      // the sun) plus twinkling stars across the card.
      const mx = lightX();
      const my = lightY();
      const moon = ctx.createRadialGradient(mx, my, 0, mx, my, h * 0.7);
      moon.addColorStop(0, `rgba(${colors.star}, ${0.16 * intensity})`);
      moon.addColorStop(1, `rgba(${colors.star}, 0)`);
      ctx.fillStyle = moon;
      ctx.fillRect(0, 0, w, h);
      for (const s of stars) {
        const tw = still ? 0.7 : 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(s.phase + t * s.speed));
        const r = (0.5 + s.depth * 1.1) * dpr;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colors.star}, ${(0.25 + s.depth * 0.55) * tw})`;
        ctx.fill();
      }
    };

    const drawLightning = (still: boolean) => {
      if (still) return; // no flashes in a reduced-motion still frame
      if (!bolt && t >= strikeAt) bolt = { points: makeBolt(), born: t };
      if (!bolt) return;
      const age = t - bolt.born;
      if (age > 420) {
        bolt = null;
        strikeAt = t + 3000 + Math.random() * 6000;
        return;
      }
      // Two quick pulses fading out, like a strike and its afterglow.
      const p = age / 420;
      const pulse = Math.max(0, Math.sin(p * Math.PI * 2.5)) * (1 - p);
      ctx.fillStyle = `rgba(${colors.bolt}, ${0.1 * pulse})`;
      ctx.fillRect(0, 0, w, h);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = `rgba(${colors.bolt}, ${0.85 * pulse})`;
      ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath();
      for (const [i, [x, y]] of bolt.points.entries()) {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    const drawFrame = (dt: number, still: boolean) => {
      ctx.clearRect(0, 0, w, h);
      if (kind === "rain") drawRain(dt, still, intensity > 0.6);
      else if (kind === "storm") {
        drawRain(dt, still, true);
        drawLightning(still);
      } else if (kind === "snow") drawSnow(dt, still);
      else if (kind === "clouds") drawClouds(dt, still);
      else if (kind === "fog") drawFog(still);
      else if (kind === "sun") drawSun(still);
      else if (kind === "stars") drawStars(still);
    };

    const step = (ts: number) => {
      const dt = last === 0 ? 16 : Math.min(64, ts - last);
      last = ts;
      t += dt;
      drawFrame(dt, false);
      raf = requestAnimationFrame(step);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    if (!reduced) raf = requestAnimationFrame(step);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [code, isDay, light]);

  return (
    <div ref={hostRef} aria-hidden className="pointer-events-none absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
