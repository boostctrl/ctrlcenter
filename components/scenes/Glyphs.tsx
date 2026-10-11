"use client";

import { useEffect, useRef } from "react";
import type { SceneProps } from "./index";
import { effectRgbFor } from "./color";

// Glyphs — terminal glyph rain: sparse columns of monospace characters
// falling at their own speeds, each a short trail whose head is lit in one
// accent and whose tail fades out in the other. Glyphs sit on a fixed grid
// and the bright head sweeps down over them, re-rolling the cell it enters,
// while a trail cell now and then flips to another character.
//
// This is the busiest scene under cards and the one most likely to burn CPU,
// so it is built for restraint: every glyph is rasterised ONCE in resize()
// to a sprite sheet (both accents at each brightness step) and a frame is a
// clearRect plus one drawImage per visible cell — never fillText. Column
// slots are 32 px apart across the whole width (40 at 1280 px) and at most
// a third of them — never more than 20 — carry a stream at once, so most of
// the page stays clear and a wide screen costs no more than a desktop one.
// A still frame — a few streams frozen at varied heights — is drawn under
// prefers-reduced-motion and motion "off". Not glow-gated.
//
// Characters that every generic monospace font draws without a web font:
// digits, hex letters, brackets, operators and a few box-drawing pieces.
const GLYPHS = Array.from("0123456789ABCDEF<>[]{}()/\\|=+-*#%&@$:;?!~^│┤├┼─┐└┘┌");
// Brightness steps the trail fades through (the head is a step of its own).
const STEPS = 6;

export default function Glyphs({ light, motion }: SceneProps) {
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
    // The head is nearly solid; the trail starts well under it and fades to
    // almost nothing, so a column reads as one bright glyph with an afterglow
    // rather than a wall of text. Light surfaces get the 40% page wash on
    // top, so both are lifted there.
    const headAlpha = light ? 1 : 0.9;
    const trailAlpha = light ? 0.7 : 0.6;
    // Grid metrics in device px: column pitch (slot spacing), the sprite
    // cell a glyph is drawn into, and the font that fills it. The cell and
    // pitch are whole pixels, and so is the inset that centres a cell in its
    // slot, so every sheet cell is copied on the device-pixel grid: at a
    // fractional DPR (Windows 125%, 150%) a half-pixel offset would be
    // bilinearly resampled and soften every glyph.
    const pitch = Math.round(32 * dpr);
    const cw = Math.ceil(18 * dpr);
    const ch = Math.ceil(20 * dpr);
    const inset = Math.floor((pitch - cw) / 2);
    const fontPx = 15 * dpr;
    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let raf = 0;

    type Stream = {
      col: number;
      y: number; // head position in rows (fractional)
      speed: number; // rows per frame
      len: number; // trail length in rows, head included
      c: number; // trail colour index; the head takes the other accent
      wait: number; // frames until this stream re-enters; 0 = falling
    };
    let streams: Stream[] = [];
    // The glyph index at every grid cell, and which columns carry a stream.
    let field = new Uint8Array(0);
    let taken = new Uint8Array(0);
    // Pre-rendered glyphs: a column per glyph, a row per (colour, step).
    const sheet = document.createElement("canvas");

    const randomGlyph = () => Math.floor(Math.random() * GLYPHS.length);

    // A free column for a stream: a few random probes, then a scan from a
    // random start so the choice stays even without allocating a free list.
    const freeColumn = (): number => {
      for (let i = 0; i < 4; i++) {
        const c = Math.floor(Math.random() * cols);
        if (!taken[c]) return c;
      }
      const start = Math.floor(Math.random() * cols);
      for (let i = 0; i < cols; i++) {
        const c = (start + i) % cols;
        if (!taken[c]) return c;
      }
      return start;
    };

    // Rolls a stream's shape and column and sends it in from above the top.
    // Speeds span roughly 4–12 rows a second at 60 fps, so columns visibly
    // overtake each other; trails of 8–19 rows keep most columns short.
    const launch = (s: Stream) => {
      s.col = freeColumn();
      taken[s.col] = 1;
      s.y = -1;
      s.speed = 0.07 + Math.random() * 0.13;
      s.len = 8 + Math.floor(Math.random() * 12);
      s.c = Math.random() < 0.7 ? 0 : 1;
      s.wait = 0;
    };

    // Parks a stream for half a second to four seconds before it re-enters,
    // so the number of columns in flight keeps changing.
    const park = (s: Stream) => {
      taken[s.col] = 0;
      s.wait = 30 + Math.floor(Math.random() * 210);
    };

    // Rasterise every glyph in both accents at the head brightness and each
    // trail step, so a frame only ever copies cells out of this sheet.
    const buildSheet = (colors: [string, string]) => {
      sheet.width = GLYPHS.length * cw;
      sheet.height = 2 * (STEPS + 1) * ch;
      const sctx = sheet.getContext("2d");
      if (!sctx) return;
      sctx.clearRect(0, 0, sheet.width, sheet.height);
      sctx.font = `${fontPx}px ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace`;
      sctx.textAlign = "center";
      sctx.textBaseline = "middle";
      for (let c = 0; c < 2; c++) {
        for (let step = 0; step <= STEPS; step++) {
          // Step 0 is the head; the trail steps ease out so the fade feels
          // longer at the bright end and dies away quickly at the tail.
          const a = step === 0 ? headAlpha : trailAlpha * Math.pow((STEPS + 1 - step) / STEPS, 1.1);
          sctx.fillStyle = `rgba(${colors[c]}, ${a})`;
          const y = (c * (STEPS + 1) + step) * ch;
          for (let g = 0; g < GLYPHS.length; g++) {
            sctx.fillText(GLYPHS[g], g * cw + cw / 2, y + ch / 2);
          }
        }
      }
    };

    const resize = () => {
      const colors: [string, string] = [
        effectRgbFor(light, "--accent-from"),
        effectRgbFor(light, "--accent-to"),
      ];
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      buildSheet(colors);
      cols = Math.max(1, Math.floor(w / pitch));
      rows = Math.ceil(h / ch) + 1;
      field = new Uint8Array(cols * rows);
      for (let i = 0; i < field.length; i++) field[i] = randomGlyph();
      taken = new Uint8Array(cols);
      // At most a third of the slots in flight at once — a few on narrow
      // screens so the scene never empties out, and no more than 20 on wide
      // ones, which bounds the per-frame work; the slots themselves span the
      // viewport, so the rain still reaches the right edge.
      const pool = Math.max(1, Math.min(cols, 20, Math.max(3, Math.floor(cols / 3))));
      streams = Array.from({ length: pool }, () => ({ col: 0, y: 0, speed: 0, len: 0, c: 0, wait: 0 }));
      // Seed the field mid-fall: most streams already on screen at varied
      // heights (this is also the still frame), the rest waiting their turn.
      for (const s of streams) {
        launch(s);
        if (Math.random() < 0.6) s.y = Math.random() * (rows + s.len);
        else park(s);
      }
      if (reduced) drawFrame(true);
    };

    const drawFrame = (still: boolean) => {
      ctx.clearRect(0, 0, w, h);
      for (const s of streams) {
        if (!still) {
          if (s.wait > 0) {
            if (--s.wait === 0) launch(s);
            continue;
          }
          const before = Math.floor(s.y);
          s.y += s.speed;
          const head = Math.floor(s.y);
          // The head rolls the glyph of each cell it enters, so what a column
          // shows changes with every pass instead of repeating the grid.
          if (head !== before && head < rows) field[s.col * rows + head] = randomGlyph();
          if (s.y - s.len > rows) {
            park(s);
            continue;
          }
        } else if (s.wait > 0) continue;
        const head = Math.floor(s.y);
        const x = s.col * pitch + inset;
        for (let i = 0; i < s.len; i++) {
          const r = head - i;
          if (r < 0) break;
          if (r >= rows) continue;
          // The trail's brightness step by its distance behind the head.
          const step = i === 0 ? 0 : 1 + Math.min(STEPS - 1, Math.floor((i * STEPS) / s.len));
          const c = i === 0 ? 1 - s.c : s.c;
          ctx.drawImage(sheet, field[s.col * rows + r] * cw, (c * (STEPS + 1) + step) * ch, cw, ch, x, r * ch, cw, ch);
        }
      }
      // One trail cell somewhere flips to another glyph each frame. Spread
      // over every cell in flight, a given glyph changes well under once a
      // second (WCAG 2.3.1 wants per-element flicker under 2 Hz).
      if (!still) {
        const s = streams[Math.floor(Math.random() * streams.length)];
        if (s.wait === 0) {
          const r = Math.floor(s.y) - 1 - Math.floor(Math.random() * (s.len - 1));
          if (r >= 0 && r < rows) field[s.col * rows + r] = randomGlyph();
        }
      }
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
