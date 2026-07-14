// Color helpers for scene effects. Particle/effect colors derive from the theme
// accent, but a bright accent doesn't read on the near-white light surface — so
// on light we deepen and saturate it (lower lightness, higher chroma, same hue)
// into a richer tone that still pops, mirroring the `--scene-*` CSS vars the
// gradient scenes use (app/globals.css .theme-light).

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Deepen + saturate a #rrggbb color for the light surface: keep the hue, drop
// the lightness and push saturation so the tone reads as a vivid burst rather
// than a pale wash. Returns an "r, g, b" string. (HSL counterpart of the OKLCH
// transform in .theme-light --scene-*; the two only need to feel alike.)
export function deepenForLight(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "150, 180, 240";
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let l = (max + min) / 2;
  let s = 0;
  let h = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  l = l * 0.6;
  s = Math.min(1, s * 1.15);
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const to = (t: number) => Math.round(hue(p, q, t) * 255);
  return `${to(h + 1 / 3)}, ${to(h)}, ${to(h - 1 / 3)}`;
}

// The "r, g, b" string for canvas particles: the raw accent on dark surfaces, or
// a deepened, saturated accent on the near-white light one so it contrasts
// instead of washing out. Falls back to a soft blue mid-theme-edit.
export function effectRgb(light: boolean): string {
  return effectRgbFor(light, "--accent-from");
}

// Same treatment for an arbitrary accent var, so two-color canvas scenes
// (rain, fireflies, prisms) can alternate between both gradient stops.
export function effectRgbFor(light: boolean, cssVar: string): string {
  const fallback = "150, 180, 240";
  if (typeof document === "undefined") return fallback;
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue(cssVar).trim();
  if (light) return deepenForLight(accent);
  const rgb = hexToRgb(accent);
  return rgb ? `${rgb[0]}, ${rgb[1]}, ${rgb[2]}` : fallback;
}
