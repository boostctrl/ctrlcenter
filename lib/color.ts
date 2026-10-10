// Color math for the theme builder (#332): sRGB ↔ OKLCH, and a palette
// derived from one accent with contrast guaranteed. Pure, no DOM. Contrast
// and hex parsing come from the shared theme resolver so every surface
// agrees on them.
import { themePaint } from "./theme-paint";
import type { ColorSet, ModeColors, SemanticColors } from "./theme";

export type Oklch = { l: number; c: number; h: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// #rrggbb → OKLCH (Björn Ottosson's OKLab, h in degrees).
export function hexToOklch(hex: string): Oklch {
  const rgb = themePaint.hexToRgb(hex) ?? [128, 128, 128];
  const r = srgbToLinear(rgb[0] / 255);
  const g = srgbToLinear(rgb[1] / 255);
  const b = srgbToLinear(rgb[2] / 255);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

// OKLCH → linear sRGB (unclamped), for gamut checks.
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);
  const l_ = l + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = l - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = l - 0.0894841775 * A - 1.291485548 * B;
  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
}

const inGamut = (lin: [number, number, number]) => lin.every((v) => v >= -0.0005 && v <= 1.0005);

// OKLCH → #rrggbb, reducing chroma until the color fits sRGB (hue and
// lightness kept), so a vivid hue never clips to a different one.
export function oklchToHex(color: Oklch): string {
  const l = clamp01(color.l);
  let c = Math.max(0, color.c);
  let lin = oklchToLinear({ l, c, h: color.h });
  for (let i = 0; i < 20 && !inGamut(lin); i++) {
    c *= 0.9;
    lin = oklchToLinear({ l, c, h: color.h });
  }
  return (
    "#" +
    lin
      .map((v) => Math.round(clamp01(linearToSrgb(clamp01(v))) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

export const contrast = (a: string, b: string): number => themePaint.contrast(a, b);

// Move a color's lightness toward `towards` (1 = white, 0 = black) until it
// contrasts with `against` at least `target`, keeping hue and chroma. Gives
// up at the extreme, where the gamut clamp decides.
function fitContrast(color: Oklch, against: string, target: number, towards: 0 | 1): Oklch {
  let { l } = color;
  let hex = oklchToHex({ ...color, l });
  for (let i = 0; i < 60 && contrast(hex, against) < target; i++) {
    l = towards === 1 ? Math.min(1, l + 0.015) : Math.max(0, l - 0.015);
    hex = oklchToHex({ ...color, l });
    if (l === 0 || l === 1) break;
  }
  return { ...color, l };
}

export type DerivedPalette = ModeColors & { status: SemanticColors; statusLight: SemanticColors };

// A whole palette from one accent: a surface tinted toward the accent's
// hue, an ink that clears 4.5:1 on it, the accent (and a second stop, an
// analogous hue) fitted to 3:1 on the surface, and the four semantic colors
// at fixed hues fitted to 4.5:1 — for both modes. Chroma is kept modest on
// surfaces and ink so the accent stays the loudest thing on the page.
export function derivePalette(accentHex: string, options: { hueShift?: number } = {}): DerivedPalette {
  const accent = hexToOklch(accentHex);
  const hueShift = options.hueShift ?? 30;
  const h = accent.h;
  const tint = Math.min(0.035, accent.c * 0.35);

  const mode = (dark: boolean): ColorSet & { status: SemanticColors } => {
    const background = oklchToHex(dark ? { l: 0.17, c: tint, h } : { l: 0.955, c: tint * 0.6, h });
    const ink = fitContrast(
      dark ? { l: 0.95, c: Math.min(0.015, tint), h } : { l: 0.24, c: Math.min(0.02, tint), h },
      background,
      7,
      dark ? 1 : 0
    );
    const foreground = oklchToHex(ink);
    // The accent as given on dark (brightened only if it sinks into the
    // surface); deepened on light so it holds against the pale page.
    const main = fitContrast(
      dark ? { ...accent, l: Math.max(accent.l, 0.6) } : { ...accent, l: Math.min(accent.l, 0.55) },
      background,
      3,
      dark ? 1 : 0
    );
    const second = fitContrast({ ...main, h: (h + hueShift) % 360 }, background, 3, dark ? 1 : 0);
    const semantic = (hue: number) =>
      oklchToHex(fitContrast(dark ? { l: 0.75, c: 0.16, h: hue } : { l: 0.5, c: 0.15, h: hue }, background, 4.5, dark ? 1 : 0));
    return {
      background,
      foreground,
      accentFrom: oklchToHex(main),
      accentTo: oklchToHex(second),
      status: { up: semantic(150), down: semantic(25), warning: semantic(75), info: semantic(240) },
    };
  };
  const d = mode(true);
  const l = mode(false);
  return {
    dark: { background: d.background, foreground: d.foreground, accentFrom: d.accentFrom, accentTo: d.accentTo },
    light: { background: l.background, foreground: l.foreground, accentFrom: l.accentFrom, accentTo: l.accentTo },
    status: d.status,
    statusLight: l.status,
  };
}
