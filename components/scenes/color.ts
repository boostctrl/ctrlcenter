// Color helpers for scene effects. Particle/effect colors derive from the theme
// accent, but a bright accent doesn't read on the near-white light surface — so
// on light we deepen and saturate it (lower lightness, higher chroma, same hue)
// into a richer tone that still pops. The math is the shared theme resolver's
// (lib/theme-paint.ts), the same one that sets the `--scene-*` CSS vars the
// gradient scenes use, so canvas and CSS scenes always agree (#325).
import { themePaint } from "@/lib/theme-paint";

export function hexToRgb(hex: string): [number, number, number] | null {
  return themePaint.hexToRgb(hex);
}

// Deepen + saturate a #rrggbb color for the light surface. Returns an
// "r, g, b" string.
export function deepenForLight(hex: string): string {
  return themePaint.deepenForLight(hex);
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
