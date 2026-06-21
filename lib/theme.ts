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
  | "cyber";

export const DESIGNS: { id: DesignId; name: string; description: string }[] = [
  { id: "glass", name: "Glass", description: "Frosted and blurred (default)" },
  { id: "aero", name: "Aero", description: "Glossy translucent sheen" },
  { id: "flat", name: "Flat", description: "Solid surfaces, clean edges" },
  { id: "soft", name: "Soft", description: "Rounded, softly elevated" },
  { id: "minimal", name: "Minimal", description: "Barely-there hairlines" },
  { id: "bold", name: "Bold", description: "Sharp, high-contrast" },
  { id: "cyber", name: "Cyber", description: "Neon, techy glow" },
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
export type SceneId = "aurora" | "abyss";

export const SCENES: { id: SceneId; name: string; description: string }[] = [
  { id: "aurora", name: "Aurora", description: "Floating accent glow (default)" },
  { id: "abyss", name: "Abyss", description: "Deep sea — drifting snow & depth gauge" },
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
// applied, so toggling mode never breaks a look. The accent pair is kept the
// same across a look's two modes for continuity — only the surface colors flip.
export type ModeColors = { dark: ColorSet; light: ColorSet };

// Preset full themes for the theme builder — starting points a visitor can
// apply with one tap and then tweak.
export type PresetTheme = { name: string } & ModeColors;

export const BASE_THEMES: PresetTheme[] = [
  {
    name: "Midnight",
    dark: { background: "#06070d", foreground: "#f4f4f6", accentFrom: "#a78bfa", accentTo: "#22d3ee" },
    light: { background: "#edeef5", foreground: "#181b28", accentFrom: "#a78bfa", accentTo: "#22d3ee" },
  },
  {
    name: "Paper",
    dark: { background: "#14130e", foreground: "#ece9e0", accentFrom: "#6366f1", accentTo: "#0ea5e9" },
    light: { background: "#f6f5f1", foreground: "#1c1b18", accentFrom: "#6366f1", accentTo: "#0ea5e9" },
  },
  {
    name: "Nord",
    dark: { background: "#2e3440", foreground: "#e5e9f0", accentFrom: "#88c0d0", accentTo: "#81a1c1" },
    light: { background: "#eceff4", foreground: "#2e3440", accentFrom: "#5e81ac", accentTo: "#81a1c1" },
  },
  {
    name: "Forest",
    dark: { background: "#0c1410", foreground: "#e7f0e9", accentFrom: "#34d399", accentTo: "#2dd4bf" },
    light: { background: "#eef4ee", foreground: "#14241b", accentFrom: "#0d9488", accentTo: "#15a394" },
  },
  {
    name: "Ember",
    dark: { background: "#140b0a", foreground: "#f6ece8", accentFrom: "#fb7185", accentTo: "#fbbf24" },
    light: { background: "#f8efe9", foreground: "#2a1714", accentFrom: "#e11d48", accentTo: "#d97706" },
  },
  {
    name: "Slate",
    dark: { background: "#0f1115", foreground: "#e6e8ec", accentFrom: "#60a5fa", accentTo: "#a78bfa" },
    light: { background: "#eef0f3", foreground: "#1a1d24", accentFrom: "#3b82f6", accentTo: "#8b5cf6" },
  },
  {
    name: "Rosé",
    dark: { background: "#1a1016", foreground: "#f5e9f0", accentFrom: "#fb7185", accentTo: "#f472b6" },
    light: { background: "#f8eef3", foreground: "#2a121f", accentFrom: "#e11d48", accentTo: "#db2777" },
  },
  {
    name: "Sand",
    dark: { background: "#161109", foreground: "#efe6d4", accentFrom: "#d97706", accentTo: "#f59e0b" },
    light: { background: "#f4ecdf", foreground: "#2b2418", accentFrom: "#b45309", accentTo: "#d97706" },
  },
];

// A theme pack is a curated, art-directed look applied in one tap: a palette
// bundled with the design (card surface) and scene (backdrop + ornament) that
// were composed to go with it. Unlike a bare palette, applying a pack sets all
// three at once — but the visitor can still tweak each part afterward.
export type ThemePack = { name: string; design: DesignId; scene: SceneId } & ModeColors;

export const THEME_PACKS: ThemePack[] = [
  {
    // The headline curated look built on the Abyss scene; named distinctly from
    // the scene (deepest ocean trench) so the two "Abyss"-flavored entries in the
    // theme builder don't collide. Dark = deep trench; light = sunlit shallows.
    name: "Mariana",
    design: "glass",
    scene: "abyss",
    dark: { background: "#02060a", foreground: "#c7d6db", accentFrom: "#5fe3d6", accentTo: "#2f8f9d" },
    light: { background: "#e7f4f5", foreground: "#0c3a40", accentFrom: "#0e9aa7", accentTo: "#2f8f9d" },
  },
];
