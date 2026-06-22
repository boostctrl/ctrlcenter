// Color helpers for scene effects. Particle/effect colors derive from the theme
// accent, but a pale accent doesn't read on a light surface — so on light we
// blend the accent toward the foreground (which is dark in light mode) to get a
// deeper, contrasting tone while staying on-palette.

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Linear blend of two #rrggbb colors as an "r, g, b" string; t=0 → a, t=1 → b.
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a) ?? [150, 180, 240];
  const cb = hexToRgb(b) ?? [0, 0, 0];
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * k);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * k);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * k);
  return `${r}, ${g}, ${bl}`;
}

// The "r, g, b" string for canvas particles: the raw accent on dark surfaces, or
// the accent blended halfway toward the foreground on light ones so it contrasts
// instead of washing out. Falls back to a soft blue mid-theme-edit.
export function effectRgb(light: boolean): string {
  const fallback = "150, 180, 240";
  if (typeof document === "undefined") return fallback;
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue("--accent-from").trim();
  if (light) {
    const fg = cs.getPropertyValue("--foreground").trim();
    return mixHex(accent, fg, 0.5);
  }
  const rgb = hexToRgb(accent);
  return rgb ? `${rgb[0]}, ${rgb[1]}, ${rgb[2]}` : fallback;
}
