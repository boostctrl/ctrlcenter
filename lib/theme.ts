// Type-only: lib/theme.ts must stay free of runtime imports, since the smoke
// run loads it straight into Node (scripts/smoke.mjs).
import type { FontId } from "./fonts";

// The built-in default accent gradient (page heading, primary buttons, focus
// rings, background glow), used when neither the admin nor the visitor has
// chosen one.
export const DEFAULT_ACCENT = { from: "#a78bfa", to: "#22d3ee" } as const;

// Designs change the look-and-feel of the shared surface (rounding, blur,
// borders, shadows, background glow) via CSS tokens — see app/globals.css. They
// are independent of the colors, so any design works with any palette. "glass"
// is the default and has no class (the :root tokens).
export type DesignId =
  | "glass"
  | "aero"
  | "flat"
  | "soft"
  | "minimal"
  | "bold"
  | "cyber"
  | "clay"
  | "frost"
  | "outline"
  | "paper"
  | "gradient"
  | "aura"
  | "emboss"
  | "carve"
  | "stripe"
  | "sketch"
  | "console";

export const DESIGNS: { id: DesignId; name: string; description: string }[] = [
  { id: "glass", name: "Glass", description: "Frosted and blurred (default)" },
  { id: "aero", name: "Aero", description: "Glossy translucent sheen" },
  { id: "flat", name: "Flat", description: "Solid surfaces, clean edges" },
  { id: "soft", name: "Soft", description: "Rounded, softly elevated" },
  { id: "minimal", name: "Minimal", description: "Barely-there hairlines" },
  { id: "bold", name: "Bold", description: "Sharp, high-contrast" },
  { id: "cyber", name: "Cyber", description: "Neon, techy glow" },
  { id: "clay", name: "Clay", description: "Chunky, soft-moulded" },
  { id: "frost", name: "Frost", description: "Heavy frosted glass" },
  { id: "outline", name: "Outline", description: "Accent-outlined, no fill" },
  { id: "paper", name: "Paper", description: "Opaque, softly shadowed" },
  { id: "gradient", name: "Gradient", description: "Accent-washed surface" },
  { id: "aura", name: "Aura", description: "Borderless, haloed in accent glow" },
  { id: "emboss", name: "Emboss", description: "Soft-raised from the page" },
  { id: "carve", name: "Carve", description: "Recessed, pressed into the page" },
  { id: "stripe", name: "Stripe", description: "Crisp card, accent top bar" },
  { id: "sketch", name: "Sketch", description: "Hand-drawn dashed outlines" },
  { id: "console", name: "Console", description: "Terminal panel, accent edge" },
];

export const DESIGN_IDS = DESIGNS.map((d) => d.id) as [DesignId, ...DesignId[]];

export const DEFAULT_DESIGN: DesignId = "glass";

export function isDesignId(v: unknown): v is DesignId {
  return typeof v === "string" && (DESIGN_IDS as string[]).includes(v);
}

// Scenes own the background composition + motion + an optional signature
// ornament — the parts a "design" (card surface) doesn't touch. Each is a React
// component bundle (see components/scenes) selected by a `scene-<id>` class on
// <html>; the components read the color CSS vars, so any scene works with any
// palette. "aurora" is the default — the floating accent glow blobs.
// The pre-1.4 "glow", "vortex" and "mesh" scenes were retired (all three were
// soft gradient washes Aurora/Nebula already cover); the 3.0 migration put a
// config still naming one back on the default (#305). "none" is a plain
// surface with no backdrop at all (#327).
export type SceneId =
  | "none"
  | "aurora"
  | "abyss"
  | "nebula"
  | "grid"
  | "starfield"
  | "waves"
  | "rays"
  | "traces"
  | "dots"
  | "horizon"
  | "orbit"
  | "peaks"
  | "rain"
  | "fireflies"
  | "blueprint"
  | "prisms"
  | "petals"
  | "comets"
  | "topography"
  | "snow"
  | "embers"
  | "bokeh"
  | "beams"
  | "bubbles"
  | "glyphs";

// `still` marks a scene that never moves (badged "Still" in the pickers; the
// motion controls have nothing to do for it).
export const SCENES: { id: SceneId; name: string; description: string; still?: true }[] = [
  { id: "none", name: "None", description: "A plain surface, no backdrop" },
  { id: "aurora", name: "Aurora", description: "Floating accent glow (default)" },
  { id: "abyss", name: "Abyss", description: "Deep sea — drifting marine snow" },
  { id: "nebula", name: "Nebula", description: "Drifting clouds of accent light" },
  { id: "grid", name: "Grid", description: "Perspective grid to the horizon" },
  { id: "starfield", name: "Starfield", description: "Twinkling stars + a few constellations" },
  { id: "waves", name: "Waves", description: "Layered waves along the base" },
  { id: "rays", name: "Rays", description: "Sweeping beams of accent light" },
  { id: "traces", name: "Traces", description: "Circuit-board traces with signal pulses" },
  { id: "dots", name: "Dots", description: "Drifting halftone dot field" },
  { id: "horizon", name: "Horizon", description: "Retro sun sinking to a glowing horizon" },
  { id: "orbit", name: "Orbit", description: "Orbital rings with wandering planets" },
  { id: "peaks", name: "Peaks", description: "Layered mountain ridgelines in haze", still: true },
  { id: "rain", name: "Rain", description: "Gentle streaks of falling accent rain" },
  { id: "fireflies", name: "Fireflies", description: "Wandering, softly pulsing lights" },
  { id: "blueprint", name: "Blueprint", description: "Drafting-paper grid with construction marks", still: true },
  { id: "prisms", name: "Prisms", description: "Drifting translucent geometric shards" },
  { id: "petals", name: "Petals", description: "Cherry-blossom petals on the breeze" },
  { id: "comets", name: "Comets", description: "Shooting stars with fading trails" },
  { id: "topography", name: "Topography", description: "Nested contour lines, a map's relief", still: true },
  { id: "snow", name: "Snow", description: "Round flakes drifting down on a shared gust" },
  { id: "embers", name: "Embers", description: "Sparks lifting off the base, fading as they climb" },
  { id: "bokeh", name: "Bokeh", description: "Out-of-focus discs of light, drifting" },
  { id: "beams", name: "Beams", description: "Diagonal bars of light sweeping slowly" },
  { id: "bubbles", name: "Bubbles", description: "Rings rising, wobbling and popping" },
  { id: "glyphs", name: "Glyphs", description: "Terminal glyphs raining down, lit by the accent" },
];

export const SCENE_IDS = SCENES.map((s) => s.id) as [SceneId, ...SceneId[]];

export const DEFAULT_SCENE: SceneId = "aurora";

export function isSceneId(v: unknown): v is SceneId {
  return typeof v === "string" && (SCENE_IDS as string[]).includes(v);
}

// The four colors that drive the custom-theme CSS variables: page background,
// ink/foreground, and the accent gradient pair.
export type ColorSet = {
  background: string;
  foreground: string;
  accentFrom: string;
  accentTo: string;
};

// Every look (palette, pack, saved theme, active theme) carries a cohesive
// light AND dark color set; the resolved light/dark mode selects which one is
// applied, so toggling mode never breaks a look. Each variant carries its own
// accent pair too, so a look can (and often does) deepen its accent for light.
export type ModeColors = { dark: ColorSet; light: ColorSet };

// Preset full themes for the theme builder — starting points a visitor can
// apply with one tap and then tweak.
export type PresetTheme = { name: string } & ModeColors;

// Color-only presets, ordered around the hue wheel (neutral → warm → green →
// teal/cyan → blue → indigo → violet → pink) so the palette row reads as an even
// spectrum rather than clustering on any one family.
export const BASE_THEMES: PresetTheme[] = [
  {
    name: "Mono",
    dark: { background: "#0f0f10", foreground: "#e8e8ea", accentFrom: "#a1a1aa", accentTo: "#71717a" },
    light: { background: "#efeff0", foreground: "#1b1b1d", accentFrom: "#52525b", accentTo: "#71717a" },
  },
  {
    // Warm-gray counterpart to Mono's cool zinc: greige surfaces with muted
    // stone accents — the "no color" choice that still feels warm.
    name: "Stone",
    dark: { background: "#131211", foreground: "#e8e6e3", accentFrom: "#a8a29e", accentTo: "#78716c" },
    light: { background: "#f1efec", foreground: "#26231f", accentFrom: "#57534e", accentTo: "#78716c" },
  },
  {
    name: "Crimson",
    dark: { background: "#150807", foreground: "#f6e6e4", accentFrom: "#ef4444", accentTo: "#f87171" },
    light: { background: "#f8eceb", foreground: "#2a1110", accentFrom: "#dc2626", accentTo: "#b91c1c" },
  },
  {
    name: "Terracotta",
    dark: { background: "#170e0b", foreground: "#f2e6e0", accentFrom: "#e2725b", accentTo: "#d99058" },
    light: { background: "#f6ece6", foreground: "#31201a", accentFrom: "#bc4a2f", accentTo: "#a8642e" },
  },
  {
    name: "Ember",
    dark: { background: "#160c06", foreground: "#f6ebe2", accentFrom: "#fb923c", accentTo: "#f97316" },
    light: { background: "#f7eee3", foreground: "#2a1a0e", accentFrom: "#ea580c", accentTo: "#c2410c" },
  },
  {
    name: "Sand",
    dark: { background: "#161109", foreground: "#efe6d4", accentFrom: "#d97706", accentTo: "#f59e0b" },
    light: { background: "#f4ecdf", foreground: "#2b2418", accentFrom: "#b45309", accentTo: "#d97706" },
  },
  {
    name: "Gruvbox",
    dark: { background: "#1d2021", foreground: "#ebdbb2", accentFrom: "#fabd2f", accentTo: "#fe8019" },
    light: { background: "#fbf1c7", foreground: "#3c3836", accentFrom: "#d65d0e", accentTo: "#b57614" },
  },
  {
    name: "Citrus",
    dark: { background: "#121406", foreground: "#eef0dc", accentFrom: "#a3e635", accentTo: "#facc15" },
    light: { background: "#f4f5e2", foreground: "#23260f", accentFrom: "#65a30d", accentTo: "#ca8a04" },
  },
  {
    name: "Forest",
    dark: { background: "#0c1410", foreground: "#e7f0e9", accentFrom: "#34d399", accentTo: "#10b981" },
    light: { background: "#eef4ee", foreground: "#14241b", accentFrom: "#059669", accentTo: "#047857" },
  },
  {
    name: "Everforest",
    dark: { background: "#2d353b", foreground: "#d3c6aa", accentFrom: "#a7c080", accentTo: "#83c092" },
    // The light ink is a step deeper than Everforest's own #5c6a72, which sat
    // at 4.1:1 on a card's fill (#322).
    light: { background: "#f3ead3", foreground: "#4a575e", accentFrom: "#8da101", accentTo: "#35a77c" },
  },
  {
    name: "Monokai",
    dark: { background: "#1f1f1c", foreground: "#f8f8f2", accentFrom: "#a6e22e", accentTo: "#f92672" },
    light: { background: "#f5f5ef", foreground: "#272822", accentFrom: "#669900", accentTo: "#e6186c" },
  },
  {
    name: "Solarized",
    dark: { background: "#002b36", foreground: "#eee8d5", accentFrom: "#2aa198", accentTo: "#b58900" },
    light: { background: "#fdf6e3", foreground: "#073642", accentFrom: "#268bd2", accentTo: "#2aa198" },
  },
  {
    name: "Aqua",
    dark: { background: "#04141a", foreground: "#d6f0f3", accentFrom: "#22d3ee", accentTo: "#38bdf8" },
    light: { background: "#e6f6fa", foreground: "#0a2a32", accentFrom: "#0891b2", accentTo: "#0284c7" },
  },
  {
    name: "Cobalt",
    dark: { background: "#06101f", foreground: "#dbe7f5", accentFrom: "#3b82f6", accentTo: "#06b6d4" },
    light: { background: "#e8f0f9", foreground: "#0e2038", accentFrom: "#1d4ed8", accentTo: "#0e7490" },
  },
  {
    name: "Nord",
    dark: { background: "#2e3440", foreground: "#e5e9f0", accentFrom: "#88c0d0", accentTo: "#81a1c1" },
    light: { background: "#eceff4", foreground: "#2e3440", accentFrom: "#5e81ac", accentTo: "#81a1c1" },
  },
  {
    name: "Tokyo",
    dark: { background: "#1a1b26", foreground: "#c0caf5", accentFrom: "#7aa2f7", accentTo: "#2ac3de" },
    light: { background: "#e1e2e7", foreground: "#343b58", accentFrom: "#3760bf", accentTo: "#0d9bb5" },
  },
  {
    name: "Indigo",
    dark: { background: "#0d0f1c", foreground: "#e3e6f5", accentFrom: "#818cf8", accentTo: "#6366f1" },
    light: { background: "#ecedf8", foreground: "#16182c", accentFrom: "#4f46e5", accentTo: "#4338ca" },
  },
  {
    name: "Grape",
    dark: { background: "#140d1f", foreground: "#ece6f5", accentFrom: "#a855f7", accentTo: "#7c3aed" },
    light: { background: "#f2ecfb", foreground: "#241634", accentFrom: "#9333ea", accentTo: "#7c3aed" },
  },
  {
    name: "Dracula",
    dark: { background: "#1e1f29", foreground: "#f8f8f2", accentFrom: "#bd93f9", accentTo: "#ff79c6" },
    light: { background: "#f5f3fb", foreground: "#282a36", accentFrom: "#9a59e0", accentTo: "#e0539f" },
  },
  {
    name: "Catppuccin",
    dark: { background: "#1e1e2e", foreground: "#cdd6f4", accentFrom: "#cba6f7", accentTo: "#f5c2e7" },
    light: { background: "#eff1f5", foreground: "#4c4f69", accentFrom: "#8839ef", accentTo: "#ea76cb" },
  },
  {
    name: "Rosé",
    dark: { background: "#1a1016", foreground: "#f5e9f0", accentFrom: "#fb7185", accentTo: "#f472b6" },
    light: { background: "#f8eef3", foreground: "#2a121f", accentFrom: "#e11d48", accentTo: "#db2777" },
  },
];

// A wallpaper (#333): an image behind the scene, per mode. `src` is an
// https:// (or http://) URL or a same-origin path such as an upload's
// /api/icons/<name>; blur in px, dim as a percent toward the page color, and
// how the image fits the viewport.
export type WallpaperFit = "cover" | "contain" | "tile";

export const WALLPAPER_FITS: { id: WallpaperFit; name: string }[] = [
  { id: "cover", name: "Fill" },
  { id: "contain", name: "Fit" },
  { id: "tile", name: "Tile" },
];

export const WALLPAPER_FIT_IDS = WALLPAPER_FITS.map((f) => f.id) as [WallpaperFit, ...WallpaperFit[]];

export type Wallpaper = { src: string; blur: number; dim: number; fit: WallpaperFit };

export const MAX_WALLPAPER_BLUR = 40;
export const MAX_WALLPAPER_SRC = 2048;

// A usable wallpaper source: an absolute http(s) URL or a same-origin path
// (not protocol-relative), with no whitespace or control characters, so it
// can be quoted into a CSS url() safely.
export function isWallpaperSrc(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= MAX_WALLPAPER_SRC &&
    /^(https?:\/\/[^\s\x00-\x1f"'()\\]+|\/(?!\/)[^\s\x00-\x1f"'()\\]*)$/.test(v)
  );
}

export function sanitizeWallpaper(input: unknown): Wallpaper | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (!isWallpaperSrc(raw.src)) return null;
  const num = (v: unknown, max: number, dflt: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : dflt;
  const fit = (WALLPAPER_FIT_IDS as string[]).includes(raw.fit as string) ? (raw.fit as WallpaperFit) : "cover";
  return { src: raw.src, blur: num(raw.blur, MAX_WALLPAPER_BLUR, 0), dim: num(raw.dim, 100, 0), fit };
}

export function wallpaperEqual(a: Wallpaper | null | undefined, b: Wallpaper | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.src === b.src && a.blur === b.blur && a.dim === b.dim && a.fit === b.fit;
}

// The bundled backgrounds (#348): small SVG patterns shipped under
// public/backgrounds/, offered as a "Bundled" row wherever a wallpaper is
// chosen. Each is a plain same-origin path, so it passes isWallpaperSrc and
// goes through the resolver, themes, share codes and config like any other
// wallpaper; `fit` is how the pattern was drawn to be shown. The paths are
// API: a visitor's theme or a config may name one, so retiring a file needs
// a migration step, not a delete. Neutral grey at low opacity, so each reads
// on both light and dark surfaces.
export type BundledBackground = {
  id: string;
  name: string;
  description: string;
  src: string;
  fit: WallpaperFit;
};

export const BUNDLED_BACKGROUNDS: BundledBackground[] = [
  { id: "linen", name: "Linen", description: "Fine woven threads", src: "/backgrounds/linen.svg", fit: "tile" },
  { id: "hatch", name: "Hatch", description: "Fine diagonal hairlines", src: "/backgrounds/hatch.svg", fit: "tile" },
  { id: "honeycomb", name: "Honeycomb", description: "A hex lattice", src: "/backgrounds/honeycomb.svg", fit: "tile" },
  { id: "grain", name: "Grain", description: "Soft film grain", src: "/backgrounds/grain.svg", fit: "tile" },
  { id: "vignette", name: "Vignette", description: "Corners darken softly", src: "/backgrounds/vignette.svg", fit: "cover" },
];

// Semantic colors (#331): up, down, warning and info, as a theme's own per
// mode. Absent, the stylesheet's defaults apply (pale on dark, deep on light).
export type SemanticKey = "up" | "down" | "warning" | "info";

export type SemanticColors = Record<SemanticKey, string>;

export const SEMANTIC_FIELDS: { key: SemanticKey; label: string; description: string }[] = [
  { key: "up", label: "Up", description: "Online dots, success, recovered" },
  { key: "down", label: "Down", description: "Offline dots, errors, danger buttons" },
  { key: "warning", label: "Warning", description: "Certificates near expiry, cautions" },
  { key: "info", label: "Info", description: "Maintenance, notices" },
];

export const SEMANTIC_KEYS = SEMANTIC_FIELDS.map((f) => f.key) as [SemanticKey, ...SemanticKey[]];

// The stylesheet's defaults per mode (app/globals.css), for the pickers.
export const DEFAULT_SEMANTIC: Record<"dark" | "light", SemanticColors> = {
  dark: { up: "#00d294", down: "#ff6568", warning: "#fcbb00", info: "#00bcfe" },
  light: { up: "#007956", down: "#bf000f", warning: "#953d00", info: "#0069a4" },
};

const HEX6 = /^#[0-9a-fA-F]{6}$/;

// Validate a stored/imported set: all four #rrggbb colors, or null.
export function sanitizeSemantic(input: unknown): SemanticColors | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const out = {} as SemanticColors;
  for (const k of SEMANTIC_KEYS) {
    const v = raw[k];
    if (typeof v !== "string" || !HEX6.test(v)) return null;
    out[k] = v;
  }
  return out;
}

export function semanticEqual(a: SemanticColors | null | undefined, b: SemanticColors | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return SEMANTIC_KEYS.every((k) => a[k].toLowerCase() === b[k].toLowerCase());
}

// Density (#330): how much air the layout has. Tailwind derives every spacing
// utility (paddings, gaps, the icon boxes) from one --spacing token, so the
// resolver scales that token by the factor on <html> and text stays its size.
export type Density = "compact" | "comfortable" | "spacious";

export const DENSITIES: { id: Density; name: string; factor: number; description: string }[] = [
  { id: "compact", name: "Compact", factor: 0.85, description: "Tighter paddings and gaps" },
  { id: "comfortable", name: "Comfortable", factor: 1, description: "As designed" },
  { id: "spacious", name: "Spacious", factor: 1.15, description: "More air around everything" },
];

export const DENSITY_IDS = DENSITIES.map((d) => d.id) as [Density, ...Density[]];

export const DEFAULT_DENSITY: Density = "comfortable";

export function isDensity(v: unknown): v is Density {
  return typeof v === "string" && (DENSITY_IDS as string[]).includes(v);
}

// Scene effects (#327): how strongly the backdrop shows (intensity, a percent
// of its full opacity) and how much it moves — "normal" as designed, "calm"
// at half speed, "off" a still frame. Chosen per mode alongside the scene,
// saved with a theme and promotable, like the tune. The visitor's own Reduce
// motion switch (Preferences) overrides the motion to "off" everywhere.
export type MotionLevel = "normal" | "calm" | "off";

export const MOTION_LEVELS: { id: MotionLevel; name: string; description: string }[] = [
  { id: "normal", name: "Full", description: "As the scene is designed" },
  { id: "calm", name: "Calm", description: "Half speed, half the work" },
  { id: "off", name: "Still", description: "A single frame, no movement" },
];

export const MOTION_IDS = MOTION_LEVELS.map((m) => m.id) as [MotionLevel, ...MotionLevel[]];

export function isMotionLevel(v: unknown): v is MotionLevel {
  return typeof v === "string" && (MOTION_IDS as string[]).includes(v);
}

export type SceneFx = { intensity: number; motion: MotionLevel };

export const DEFAULT_SCENE_FX: SceneFx = { intensity: 100, motion: "normal" };

export function isDefaultSceneFx(fx: SceneFx | null | undefined): boolean {
  return !fx || (fx.intensity === 100 && fx.motion === "normal");
}

// Validate stored/imported scene effects, or null. A partial object keeps the
// defaults for what it lacks.
export function sanitizeSceneFx(input: unknown): SceneFx | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const out = { ...DEFAULT_SCENE_FX };
  let any = false;
  if (typeof raw.intensity === "number" && Number.isFinite(raw.intensity)) {
    out.intensity = Math.min(100, Math.max(0, Math.round(raw.intensity)));
    any = true;
  }
  if (isMotionLevel(raw.motion)) {
    out.motion = raw.motion;
    any = true;
  }
  return any ? out : null;
}

// Fine-tuning over a design (#326): each knob scales one of the design's
// surface tokens — radius, border weight, blur, shadow depth, fill (card
// opacity) and the scene glow — as a percentage of the design's own value, so
// 100 everywhere is the design untouched and any design stays the recipe. The
// resolver paints them as `--tune-*` multipliers (lib/theme-paint.ts) that the
// design tokens in app/globals.css multiply in. Chosen per mode, saved with a
// theme, promotable to the site default, and a pack may ship one.
export type TuneKey = "radius" | "border" | "blur" | "shadow" | "fill" | "glow";

export type Tune = Record<TuneKey, number>;

export const TUNE_FIELDS: { key: TuneKey; label: string; description: string; max: number }[] = [
  { key: "radius", label: "Corner radius", description: "How rounded cards and buttons are", max: 200 },
  { key: "border", label: "Border weight", description: "The card edge's thickness", max: 300 },
  { key: "blur", label: "Blur", description: "How much the backdrop blurs through a card", max: 200 },
  { key: "shadow", label: "Shadow depth", description: "The weight of card shadows and glows", max: 200 },
  { key: "fill", label: "Card opacity", description: "How solid the card fill is", max: 300 },
  { key: "glow", label: "Scene glow", description: "The backdrop's brightness behind the cards", max: 200 },
];

export const TUNE_KEYS = TUNE_FIELDS.map((f) => f.key) as [TuneKey, ...TuneKey[]];

export const DEFAULT_TUNE: Tune = { radius: 100, border: 100, blur: 100, shadow: 100, fill: 100, glow: 100 };

export function isDefaultTune(t: Tune | null | undefined): boolean {
  return !t || TUNE_KEYS.every((k) => t[k] === 100);
}

// Validate a stored/imported tune: every knob a finite integer within its
// range, or null. Tolerates a partial object by filling the rest with 100.
export function sanitizeTune(input: unknown): Tune | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const out = { ...DEFAULT_TUNE };
  let any = false;
  for (const f of TUNE_FIELDS) {
    const v = raw[f.key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    out[f.key] = Math.min(f.max, Math.max(0, Math.round(v)));
    any = true;
  }
  return any ? out : null;
}

// Equality for the builder's active-state checks (#328): hex compares
// case-insensitively, and an absent tune or scene effects equals the default.
export function colorSetsEqual(a: ColorSet, b: ColorSet): boolean {
  const k = (c: ColorSet) =>
    [c.background, c.foreground, c.accentFrom, c.accentTo].map((h) => h.toLowerCase()).join("|");
  return k(a) === k(b);
}

export function tunesEqual(a: Tune | null | undefined, b: Tune | null | undefined): boolean {
  if (isDefaultTune(a) || isDefaultTune(b)) return isDefaultTune(a) && isDefaultTune(b);
  return TUNE_KEYS.every((k) => (a as Tune)[k] === (b as Tune)[k]);
}

export function sceneFxEqual(a: SceneFx | null | undefined, b: SceneFx | null | undefined): boolean {
  if (isDefaultSceneFx(a) || isDefaultSceneFx(b)) return isDefaultSceneFx(a) && isDefaultSceneFx(b);
  return (a as SceneFx).intensity === (b as SceneFx).intensity && (a as SceneFx).motion === (b as SceneFx).motion;
}

// A "Theme" is a curated, art-directed look applied in one tap: a palette
// bundled with the design (card surface) and scene (backdrop) composed to go
// with it, tailored for both light and dark, and optionally a tune over the
// design. Applying one sets all of it at once (a pack without a tune resets
// the tune); the visitor can still tweak each part afterward. (Surfaced as "Themes"
// in the builder, alongside the visitor's saved CustomThemes.)
// A pack may also carry a body font and a heading font (#330); without them
// the visitor's (or the site default's) fonts stay as they are.
export type ThemePack = {
  name: string;
  design: DesignId;
  scene: SceneId;
  // A light-mode design and scene of its own (#334); absent = the same as
  // dark, as every built-in has.
  designLight?: DesignId;
  sceneLight?: SceneId;
  tune?: Tune;
  font?: FontId;
  headingFont?: FontId;
  // Its own semantic colors per mode (#331); absent = the stylesheet's.
  status?: SemanticColors;
  statusLight?: SemanticColors;
  // A wallpaper per mode (#333); absent = none.
  wallpaper?: Wallpaper;
  wallpaperLight?: Wallpaper;
  // On a resolved gallery pack: the built-in it stands for, if any (#334);
  // the builder badges the stock one by it whatever it's called now.
  builtin?: string;
} & ModeColors;

// What visitors may change about the theme (#335): everything, the gallery's
// themes and the light/dark mode only, or nothing (the site theme is final:
// kiosks, wall tablets, shared screens). Signed-in admins are never limited.
export type VisitorTheming = "all" | "packs" | "none";

export const VISITOR_THEMING: { id: VisitorTheming; name: string; description: string }[] = [
  { id: "all", name: "Everything", description: "The whole theme builder: themes, colors, design, scene, fonts." },
  { id: "packs", name: "Themes only", description: "Pick from the site's themes and the light/dark mode." },
  { id: "none", name: "Nothing", description: "The site theme is final — for kiosks and shared screens." },
];

export const VISITOR_THEMING_IDS = VISITOR_THEMING.map((v) => v.id) as [VisitorTheming, ...VisitorTheming[]];

// The pack's design and scene for a mode (#334).
export function packDesign(pack: ThemePack, dark: boolean): DesignId {
  return dark ? pack.design : pack.designLight ?? pack.design;
}
export function packScene(pack: ThemePack, dark: boolean): SceneId {
  return dark ? pack.scene : pack.sceneLight ?? pack.scene;
}

// The built-in theme that mirrors the app's stock appearance (first in the list,
// badged in the builder).
export const DEFAULT_THEME_NAME = "Default";

export const THEME_PACKS: ThemePack[] = [
  {
    // The app's out-of-box look: Glass surface, Aurora scene, the default
    // colors. Listed first and badged "Default" — applying it restores the
    // stock appearance. Kept in sync with the :root / .theme-light CSS defaults
    // and DEFAULT_ACCENT above.
    name: "Default",
    design: "glass",
    scene: "aurora",
    dark: { background: "#06070d", foreground: "#f4f4f6", accentFrom: "#a78bfa", accentTo: "#22d3ee" },
    light: { background: "#eceef3", foreground: "#181b24", accentFrom: "#a78bfa", accentTo: "#22d3ee" },
  },
  {
    // Deepest ocean trench, built on the Abyss scene. Dark = the trench;
    // light = sunlit shallows.
    name: "Mariana",
    design: "glass",
    scene: "abyss",
    dark: { background: "#02060a", foreground: "#c7d6db", accentFrom: "#5fe3d6", accentTo: "#2f8f9d" },
    light: { background: "#e7f4f5", foreground: "#0c3a40", accentFrom: "#0e9aa7", accentTo: "#2f8f9d" },
  },
  {
    // Synthwave magenta/cyan on the Grid scene, paired with the Cyber design.
    name: "Outrun",
    design: "cyber",
    scene: "grid",
    dark: { background: "#0c0716", foreground: "#f3e9f6", accentFrom: "#ff4dd6", accentTo: "#22d3ee" },
    light: { background: "#f4eefb", foreground: "#241430", accentFrom: "#d6219a", accentTo: "#0ea5c4" },
  },
  {
    // Deep indigo night sky on the Starfield scene with a minimal surface.
    name: "Observatory",
    design: "minimal",
    scene: "starfield",
    dark: { background: "#05070f", foreground: "#dfe4f2", accentFrom: "#7aa2ff", accentTo: "#a78bfa" },
    light: { background: "#eef1f8", foreground: "#161a2b", accentFrom: "#4f6bd6", accentTo: "#7c5cf0" },
  },
  {
    // Calm teal/aqua tides on the Waves scene with a soft surface.
    name: "Tide",
    design: "soft",
    scene: "waves",
    dark: { background: "#04110f", foreground: "#dceee9", accentFrom: "#2dd4bf", accentTo: "#38bdf8" },
    light: { background: "#e8f5f1", foreground: "#0d2a26", accentFrom: "#0d9488", accentTo: "#0284c7" },
  },
  {
    // Soft rose→violet bloom under drifting cherry-blossom Petals with a glossy
    // Aero surface. Designed light-first: a warm pale-pink wash that reads as a
    // bright, airy theme, with a complementary plum dark.
    name: "Bloom",
    design: "aero",
    scene: "petals",
    light: { background: "#faedf4", foreground: "#3a172e", accentFrom: "#db2777", accentTo: "#7c3aed" },
    dark: { background: "#170e1b", foreground: "#f4e9f2", accentFrom: "#f472b6", accentTo: "#a78bfa" },
  },
  {
    // Teal-to-lime over the sweeping Rays scene, chunky Clay surface.
    name: "Lagoon",
    design: "clay",
    scene: "rays",
    dark: { background: "#0a1416", foreground: "#dff0ee", accentFrom: "#2dd4bf", accentTo: "#a3e635" },
    light: { background: "#e9f6f2", foreground: "#0c2622", accentFrom: "#0d9488", accentTo: "#65a30d" },
  },
  {
    // Terminal green over the motherboard Traces scene with a Bold surface.
    name: "Circuit",
    design: "bold",
    scene: "traces",
    dark: { background: "#020806", foreground: "#d7f7e4", accentFrom: "#34d399", accentTo: "#22d3ee" },
    light: { background: "#e9f7ef", foreground: "#06231a", accentFrom: "#059669", accentTo: "#0891b2" },
  },
  {
    // Icy blue over hazy mountain ridgelines with the heavy Frost surface.
    name: "Frostbite",
    design: "frost",
    scene: "peaks",
    dark: { background: "#050a12", foreground: "#d6e6f2", accentFrom: "#7dd3fc", accentTo: "#38bdf8" },
    light: { background: "#eef5fb", foreground: "#0f2230", accentFrom: "#0284c7", accentTo: "#0369a1" },
  },
  {
    // Printed-ink monochrome: the Paper surface over a drifting Dots halftone.
    name: "Halftone",
    design: "paper",
    scene: "dots",
    dark: { background: "#111113", foreground: "#ececec", accentFrom: "#d6d3d1", accentTo: "#a8a29e" },
    light: { background: "#f4f4f2", foreground: "#1c1c1a", accentFrom: "#57534e", accentTo: "#292524" },
  },
  {
    // Violet event horizon: the Outline surface around orbital line-art.
    name: "Singularity",
    design: "outline",
    scene: "orbit",
    dark: { background: "#0a0612", foreground: "#ece6f7", accentFrom: "#c084fc", accentTo: "#a855f7" },
    light: { background: "#f1ecfa", foreground: "#1d1430", accentFrom: "#9333ea", accentTo: "#7e22ce" },
  },
  {
    // Sunrise warmth on the retro Horizon sun with the Gradient surface.
    // Designed light-first — a soft peach wash, with a warm ember dark.
    name: "Daybreak",
    design: "gradient",
    scene: "horizon",
    light: { background: "#fdeee6", foreground: "#3a1d12", accentFrom: "#fb923c", accentTo: "#f43f5e" },
    dark: { background: "#160d0a", foreground: "#f5e7e0", accentFrom: "#fb923c", accentTo: "#fb7185" },
  },
  // The 3.0 theming bundle's showcase packs (#348), appended so a gallery
  // materialised before them keeps its order.
  {
    // Firelight: amber to ember over rising sparks, with the soft-raised
    // Emboss surface.
    name: "Hearth",
    design: "emboss",
    scene: "embers",
    dark: { background: "#170d08", foreground: "#f6ebe2", accentFrom: "#f59e0b", accentTo: "#ea580c" },
    light: { background: "#f8efe6", foreground: "#2b1a10", accentFrom: "#c2410c", accentTo: "#b45309" },
  },
  {
    // Frost and pine under falling snow, pressed into the page by Carve.
    name: "Alpine",
    design: "carve",
    scene: "snow",
    dark: { background: "#07120f", foreground: "#e3efe9", accentFrom: "#a5f3fc", accentTo: "#4ade80" },
    light: { background: "#eef5f1", foreground: "#10281f", accentFrom: "#0f766e", accentTo: "#166534" },
  },
  {
    // A studio's paper and graphite with ochre and vermilion: hand-drawn
    // Sketch outlines over still contour lines, on the bundled Linen
    // background in both modes — the first built-in with a wallpaper.
    name: "Atelier",
    design: "sketch",
    scene: "topography",
    wallpaper: { src: "/backgrounds/linen.svg", blur: 0, dim: 0, fit: "tile" },
    wallpaperLight: { src: "/backgrounds/linen.svg", blur: 0, dim: 0, fit: "tile" },
    dark: { background: "#171512", foreground: "#ebe5d8", accentFrom: "#e8b04b", accentTo: "#d9674f" },
    light: { background: "#f4efe4", foreground: "#2a2521", accentFrom: "#b7791f", accentTo: "#b4473a" },
  },
  {
    // Green-on-black phosphor: the Console panel over glyph rain, set in
    // JetBrains Mono.
    name: "Terminal",
    design: "console",
    scene: "glyphs",
    font: "jetbrains",
    dark: { background: "#030805", foreground: "#c8f5d0", accentFrom: "#22c55e", accentTo: "#4ade80" },
    light: { background: "#e9f5ec", foreground: "#0b2a16", accentFrom: "#15803d", accentTo: "#166534" },
  },
];

// The admin's theme gallery (#334): the `themes:` list in config.yaml. Each
// entry either stands for a built-in pack (`builtin` names it; a `key` that
// is a built-in's name, or a key-less entry named like one, means the same
// for files from before 3.0) or is a pack of the admin's own. An entry can
// hide its pack from visitors, and the list's order is the gallery's.
//
// A built-in entry with no pack fields is the built-in as shipped (so it can
// be hidden or reordered while later versions' tweaks to it still show).
// One that carries any field other than `name` is an edited copy: its own
// optional parts (tune, fonts, status, wallpaper) apply, so clearing one
// sticks, and only the required parts fall back to the built-in when
// missing. A rename alone keeps everything else as shipped.
export type ThemeEntry = Partial<ThemePack> & {
  key?: string;
  builtin?: string;
  hidden?: boolean;
};

// Kept for the 3.0 pre-release name.
export type ThemePackOverride = ThemeEntry;

// The pack fields an entry may carry, in the order they're written.
export const PACK_FIELDS = [
  "name",
  "design",
  "scene",
  "designLight",
  "sceneLight",
  "tune",
  "font",
  "headingFont",
  "status",
  "statusLight",
  "wallpaper",
  "wallpaperLight",
  "dark",
  "light",
] as const satisfies readonly (keyof ThemePack)[];

// Just a pack's own fields (no gallery bookkeeping, no `builtin` marker),
// for storing one in an entry.
export function packFields(pack: ThemePack): ThemePack {
  const out: Partial<ThemePack> = {};
  for (const f of PACK_FIELDS) {
    const v = pack[f];
    if (v !== undefined) (out as Record<string, unknown>)[f] = v;
  }
  return out as ThemePack;
}

const CUSTOM_KEY_PREFIX = "custom-";

// A key for a pack of the admin's own: never a built-in's name.
export function newThemeEntryKey(): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${CUSTOM_KEY_PREFIX}${rnd}`;
}

// `base` as a name no pack in `taken` has: "Ocean", "Ocean 2", "Ocean 3"…
export function uniquePackName(base: string, taken: Iterable<string>): string {
  const names = new Set([...taken].map((n) => n.trim().toLowerCase()));
  const root = base.trim().slice(0, 40) || "Theme";
  if (!names.has(root.toLowerCase())) return root;
  for (let i = 2; ; i++) {
    const candidate = `${root} ${i}`.slice(0, 40);
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
}

export type ResolvedThemeEntry = {
  // The entry's key (a built-in's name for one standing for it).
  key: string;
  builtin?: string;
  hidden: boolean;
  // A built-in entry that carries its own fields (reset restores the shipped
  // pack); always true for a pack of the admin's own.
  edited: boolean;
  pack: ThemePack;
  // The stored entry this came from; absent for a built-in the list doesn't
  // mention (it shows as shipped, after the listed ones).
  entry?: ThemeEntry;
};

const builtinNamed = (name: string | undefined): ThemePack | undefined =>
  name === undefined ? undefined : THEME_PACKS.find((p) => p.name === name);

// The built-in an entry stands for, if any.
function builtinOf(e: ThemeEntry): ThemePack | undefined {
  if (e.builtin !== undefined) return builtinNamed(e.builtin);
  if (e.key !== undefined) return builtinNamed(e.key);
  // Pre-1.9 overrides had neither; they were matched by name.
  return builtinNamed(e.name);
}

const OPTIONAL_FIELDS = [
  "designLight",
  "sceneLight",
  "tune",
  "font",
  "headingFont",
  "status",
  "statusLight",
  "wallpaper",
  "wallpaperLight",
] as const;

function resolveBuiltin(base: ThemePack, e: ThemeEntry): { pack: ThemePack; edited: boolean } {
  const edited = PACK_FIELDS.some((f) => f !== "name" && e[f] !== undefined);
  if (!edited) {
    return { pack: { ...base, ...(e.name ? { name: e.name } : {}), builtin: base.name }, edited: false };
  }
  const pack: ThemePack = {
    name: e.name ?? base.name,
    design: e.design ?? base.design,
    scene: e.scene ?? base.scene,
    dark: e.dark ?? base.dark,
    light: e.light ?? base.light,
    builtin: base.name,
  };
  for (const f of OPTIONAL_FIELDS) {
    const v = e[f];
    if (v !== undefined) (pack as Record<string, unknown>)[f] = v;
  }
  return { pack, edited: true };
}

// A pack of the admin's own needs a name and both colorsets; the rest has
// defaults.
function resolveCustom(e: ThemeEntry): ThemePack | null {
  if (!e.name || !e.dark || !e.light) return null;
  const pack: ThemePack = {
    name: e.name,
    design: e.design ?? "glass",
    scene: e.scene ?? "aurora",
    dark: e.dark,
    light: e.light,
  };
  for (const f of OPTIONAL_FIELDS) {
    const v = e[f];
    if (v !== undefined) (pack as Record<string, unknown>)[f] = v;
  }
  return pack;
}

const shipped = (p: ThemePack): ResolvedThemeEntry => ({
  key: p.name,
  builtin: p.name,
  hidden: false,
  edited: false,
  pack: { ...p, builtin: p.name },
});

// The whole gallery, hidden packs included, for the admin: the entries in
// stored order (a built-in referenced twice counts once, the first time),
// then every built-in the list doesn't mention, in their shipped order. A
// list from before the gallery (3.0 pre-release overrides, nothing but
// built-in edits with no `builtin` or `hidden` markers) keeps the shipped
// order with the edits slotted in, as it always did.
export function resolveThemeGallery(entries: ThemeEntry[] | undefined): ResolvedThemeEntry[] {
  if (!entries || entries.length === 0) return THEME_PACKS.map(shipped);
  const resolved: ResolvedThemeEntry[] = [];
  const seen = new Set<string>();
  let gallery = false;
  for (const e of entries) {
    if (e.builtin !== undefined || e.hidden !== undefined) gallery = true;
    const base = builtinOf(e);
    // Naming a built-in that doesn't exist (a config from another version,
    // a typo in the file) is harmless: the entry is skipped, not a half-pack.
    if (e.builtin !== undefined && !base) continue;
    if (base) {
      if (seen.has(base.name)) continue;
      seen.add(base.name);
      const { pack, edited } = resolveBuiltin(base, e);
      resolved.push({ key: e.key ?? base.name, builtin: base.name, hidden: e.hidden === true, edited, pack, entry: e });
    } else {
      const pack = resolveCustom(e);
      if (!pack) continue;
      gallery = true;
      resolved.push({ key: e.key ?? pack.name, hidden: e.hidden === true, edited: true, pack, entry: e });
    }
  }
  if (!gallery) {
    return THEME_PACKS.map((p) => resolved.find((r) => r.builtin === p.name) ?? shipped(p));
  }
  for (const p of THEME_PACKS) if (!seen.has(p.name)) resolved.push(shipped(p));
  return resolved;
}

// The packs visitors can pick: the gallery without its hidden entries. With
// nothing stored, the built-ins themselves.
export function resolveThemePacks(entries: ThemeEntry[] | undefined): ThemePack[] {
  if (!entries || entries.length === 0) return THEME_PACKS;
  return resolveThemeGallery(entries)
    .filter((r) => !r.hidden)
    .map((r) => r.pack);
}
