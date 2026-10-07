// Pure helpers that apply the resolved theme to <html>: the mode class, the
// surface/accent CSS variables and the design/scene/font classes, plus the
// luminance math and accent/variant resolution they share. No React here —
// PrefsProvider owns the state and calls these to paint it.
import type { AccentColors, AccentOverrides } from "@/lib/prefs";
import {
  DESIGN_IDS,
  SCENE_IDS,
  type ColorSet,
  type DesignId,
  type ModeColors,
  type SceneId,
} from "@/lib/theme";
import { FONT_IDS, type FontId } from "@/lib/fonts";
import { deepenForLight } from "../scenes/color";

export type Theme = "system" | "light" | "dark";
// The two resolved appearance modes a theme part can be chosen for independently.
export type Mode = "dark" | "light";

export type Accent = AccentColors;

// Resolve whether the given mode renders dark right now ("system" follows the
// OS). Kept in sync with the no-flash inline script in app/layout.tsx.
export function resolveDark(theme: Theme): boolean {
  if (typeof window === "undefined") return true;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return theme === "dark" || (theme === "system" && prefersDark);
}

export function applyAccent(accent: Accent, dark: boolean): void {
  if (typeof document === "undefined") return;
  const s = document.documentElement.style;
  s.setProperty("--accent-from", accent.from);
  s.setProperty("--accent-to", accent.to);
  // Legible ink for content on the accent gradient (.btn-accent): near-black on
  // bright accents, white on dark ones, from the average luminance of the two
  // stops. Mirrors lm() in the no-flash script (app/layout.tsx).
  const accentLum = (luminance(accent.from) + luminance(accent.to)) / 2;
  s.setProperty("--accent-fg", accentLum >= 0.6 ? "#000000" : "#ffffff");
  // Scene backdrops read --scene-* so they can deepen + saturate the accent on
  // the near-white light surface (where the raw accent washes out) while keeping
  // it as-is on dark. Both modes are set explicitly so switching light→dark
  // clears any deepened value left on <html>.
  s.setProperty("--scene-from", dark ? accent.from : `rgb(${deepenForLight(accent.from)})`);
  s.setProperty("--scene-to", dark ? accent.to : `rgb(${deepenForLight(accent.to)})`);
}

// Swap the active design class on <html>. The default ("glass") uses the :root
// tokens and carries no class.
export function applyDesign(design: DesignId): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  DESIGN_IDS.forEach((d) => el.classList.remove(`design-${d}`));
  if (design !== "glass") el.classList.add(`design-${design}`);
}

// Swap the active scene class on <html>. <SceneLayer> renders the matching
// backdrop/ornament components; the class lets any pure-CSS scene styling apply
// before hydration. The default ("aurora") carries no class.
export function applyScene(scene: SceneId): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  SCENE_IDS.forEach((s) => el.classList.remove(`scene-${s}`));
  if (scene !== "aurora") el.classList.add(`scene-${scene}`);
}

// Swap the active font class on <html>, which repoints --font-sans. The default
// ("jakarta") uses the :root token and carries no class. See lib/fonts.ts.
export function applyFont(font: FontId): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  FONT_IDS.forEach((f) => el.classList.remove(`font-${f}`));
  if (font !== "jakarta") el.classList.add(`font-${font}`);
}

// Perceived luminance (0–1) of a #rrggbb color; non-hex falls back to mid-gray.
export function luminance(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Whether a surface color reads as light (so themed icons can pick a legible
// variant).
export function isLightColor(hex: string): boolean {
  return luminance(hex) > 0.5;
}

// Resolve the effective accent: an explicit per-visitor override wins, then the
// active look's own accent, then the admin-configured default.
export function resolveAccent(
  override: AccentColors | null,
  colors: ColorSet | null,
  fallback: Accent
): Accent {
  if (override) return override;
  if (colors) return { from: colors.accentFrom, to: colors.accentTo };
  return fallback;
}

// The accent override a mode contributes (overrides are chosen per mode).
export function overrideFor(overrides: AccentOverrides, dark: boolean): AccentColors | null {
  return dark ? overrides.dark : overrides.light;
}

// The color set a look contributes for the resolved mode.
export function variantFor(look: ModeColors | null, dark: boolean): ColorSet | null {
  if (!look) return null;
  return dark ? look.dark : look.light;
}

// Apply the whole theme state in one place. `.theme-light` ALWAYS tracks the
// resolved mode, so the light/dark toggle is always live. A look (visitor
// custom or admin default) contributes the surface colors for that mode;
// without one, the CSS defaults (`:root` dark / `.theme-light` light) apply. The
// accent is layered on last, so an accent-only override leaves the rest as-is.
export function applyAll(opts: {
  theme: Theme;
  look: ModeColors | null;
  accentOverride: AccentOverrides;
  defaultAccent: Accent;
}): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  const s = el.style;
  const dark = resolveDark(opts.theme);
  el.classList.toggle("theme-light", !dark);
  const cs = variantFor(opts.look, dark);
  if (cs) {
    s.setProperty("--background", cs.background);
    s.setProperty("--foreground", cs.foreground);
    s.setProperty("--fg", cs.foreground);
  } else {
    s.removeProperty("--background");
    s.removeProperty("--foreground");
    s.removeProperty("--fg");
  }
  applyAccent(
    resolveAccent(overrideFor(opts.accentOverride, dark), cs, opts.defaultAccent),
    dark
  );
}
