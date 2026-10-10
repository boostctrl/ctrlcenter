// Pure helpers that apply the resolved theme to <html>: the mode class, the
// surface/accent CSS variables and the design/scene/font classes, plus the
// accent/variant resolution they share. No React here — PrefsProvider owns the
// state and calls these to paint it. The color math and the painting itself
// come from lib/theme-paint.ts, the same code the no-flash inline script runs
// (#325), so the pre-hydration and hydrated paints can't drift.
import type { AccentColors, AccentOverrides } from "@/lib/prefs";
import {
  DESIGN_IDS,
  SCENE_IDS,
  type ColorSet,
  type DesignId,
  type ModeColors,
  type Density,
  type SceneFx,
  type SceneId,
  type Tune,
} from "@/lib/theme";
import { DENSITY_IDS } from "@/lib/theme";
import { FONT_IDS, type FontId } from "@/lib/fonts";
import { themePaint, type PaintIds } from "@/lib/theme-paint";

export type Theme = "system" | "light" | "dark";
// The two resolved appearance modes a theme part can be chosen for independently.
export type Mode = "dark" | "light";

export type Accent = AccentColors;

const IDS: PaintIds = { design: DESIGN_IDS, scene: SCENE_IDS, font: FONT_IDS, density: DENSITY_IDS };

// Resolve whether the given mode renders dark right now ("system" follows the
// OS). The no-flash script resolves the same way (lib/theme-paint.ts readStored).
export function resolveDark(theme: Theme): boolean {
  if (typeof window === "undefined") return true;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return theme === "dark" || (theme === "system" && prefersDark);
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

// Swap the heading font class on <html> (#330): `heading-<id>` repoints
// --font-heading; null means the body font (no class).
export function applyHeadingFont(font: FontId | null): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  FONT_IDS.forEach((f) => el.classList.remove(`heading-${f}`));
  if (font) el.classList.add(`heading-${font}`);
}

// Perceived luminance (0–1) of a #rrggbb color; non-hex falls back to mid-gray.
export function luminance(hex: string): number {
  return themePaint.luminance(hex);
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
// `tune` is the fine-tune for the resolved mode (null = the design untouched).
// The design/scene/font classes are left to applyDesign/applyScene/applyFont.
export function applyAll(opts: {
  theme: Theme;
  look: ModeColors | null;
  accentOverride: AccentOverrides;
  defaultAccent: Accent;
  tune?: Tune | null;
  sceneFx?: SceneFx | null;
  reduceMotion?: boolean;
  density?: Density | null;
}): void {
  if (typeof document === "undefined") return;
  const dark = resolveDark(opts.theme);
  const cs = variantFor(opts.look, dark);
  const accent = resolveAccent(overrideFor(opts.accentOverride, dark), cs, opts.defaultAccent);
  themePaint.apply(
    document.documentElement,
    themePaint.computePaint({
      dark,
      background: cs ? cs.background : null,
      foreground: cs ? cs.foreground : null,
      accentFrom: accent.from,
      accentTo: accent.to,
      tune: opts.tune ?? null,
      sceneFx: opts.sceneFx ?? null,
      reduceMotion: opts.reduceMotion ?? false,
      density: opts.density ?? null,
    }),
    IDS
  );
}
