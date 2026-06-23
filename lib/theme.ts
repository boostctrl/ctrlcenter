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
  | "clay";

export const DESIGNS: { id: DesignId; name: string; description: string }[] = [
  { id: "glass", name: "Glass", description: "Frosted and blurred (default)" },
  { id: "aero", name: "Aero", description: "Glossy translucent sheen" },
  { id: "flat", name: "Flat", description: "Solid surfaces, clean edges" },
  { id: "soft", name: "Soft", description: "Rounded, softly elevated" },
  { id: "minimal", name: "Minimal", description: "Barely-there hairlines" },
  { id: "bold", name: "Bold", description: "Sharp, high-contrast" },
  { id: "cyber", name: "Cyber", description: "Neon, techy glow" },
  { id: "clay", name: "Clay", description: "Chunky, soft-moulded" },
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
export type SceneId =
  | "aurora"
  | "abyss"
  | "nebula"
  | "grid"
  | "starfield"
  | "waves"
  | "mesh"
  | "constellation";

export const SCENES: { id: SceneId; name: string; description: string }[] = [
  { id: "aurora", name: "Aurora", description: "Floating accent glow (default)" },
  { id: "abyss", name: "Abyss", description: "Deep sea — drifting marine snow" },
  { id: "nebula", name: "Nebula", description: "Drifting clouds of accent light" },
  { id: "grid", name: "Grid", description: "Perspective grid to the horizon" },
  { id: "starfield", name: "Starfield", description: "Twinkling, drifting stars" },
  { id: "waves", name: "Waves", description: "Layered waves along the base" },
  { id: "mesh", name: "Mesh", description: "Morphing accent mesh gradient" },
  { id: "constellation", name: "Constellation", description: "Drifting linked stars" },
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
  {
    name: "Dracula",
    dark: { background: "#1e1f29", foreground: "#f8f8f2", accentFrom: "#bd93f9", accentTo: "#ff79c6" },
    light: { background: "#f5f3fb", foreground: "#282a36", accentFrom: "#9a59e0", accentTo: "#e0539f" },
  },
  {
    name: "Solarized",
    dark: { background: "#002b36", foreground: "#eee8d5", accentFrom: "#2aa198", accentTo: "#b58900" },
    light: { background: "#fdf6e3", foreground: "#073642", accentFrom: "#268bd2", accentTo: "#2aa198" },
  },
  {
    name: "Gruvbox",
    dark: { background: "#1d2021", foreground: "#ebdbb2", accentFrom: "#fabd2f", accentTo: "#fe8019" },
    light: { background: "#fbf1c7", foreground: "#3c3836", accentFrom: "#d65d0e", accentTo: "#b57614" },
  },
  {
    name: "Catppuccin",
    dark: { background: "#1e1e2e", foreground: "#cdd6f4", accentFrom: "#cba6f7", accentTo: "#f5c2e7" },
    light: { background: "#eff1f5", foreground: "#4c4f69", accentFrom: "#8839ef", accentTo: "#ea76cb" },
  },
  {
    name: "Tokyo",
    dark: { background: "#1a1b26", foreground: "#c0caf5", accentFrom: "#7aa2f7", accentTo: "#bb9af7" },
    light: { background: "#e1e2e7", foreground: "#343b58", accentFrom: "#3760bf", accentTo: "#9854f1" },
  },
  {
    name: "Monokai",
    dark: { background: "#1f1f1c", foreground: "#f8f8f2", accentFrom: "#a6e22e", accentTo: "#f92672" },
    light: { background: "#f5f5ef", foreground: "#272822", accentFrom: "#669900", accentTo: "#e6186c" },
  },
  {
    name: "Grape",
    dark: { background: "#140d1f", foreground: "#ece6f5", accentFrom: "#a855f7", accentTo: "#6366f1" },
    light: { background: "#f2ecfb", foreground: "#241634", accentFrom: "#9333ea", accentTo: "#4f46e5" },
  },
  {
    name: "Aqua",
    dark: { background: "#04141a", foreground: "#d6f0f3", accentFrom: "#22d3ee", accentTo: "#38bdf8" },
    light: { background: "#e6f6fa", foreground: "#0a2a32", accentFrom: "#0891b2", accentTo: "#0284c7" },
  },
];

// A "Theme" is a curated, art-directed look applied in one tap: a palette
// bundled with the design (card surface) and scene (backdrop) composed to go
// with it, tailored for both light and dark. Applying one sets all three at
// once; the visitor can still tweak each part afterward. (Surfaced as "Themes"
// in the builder, alongside the visitor's saved CustomThemes.)
export type ThemePack = { name: string; design: DesignId; scene: SceneId } & ModeColors;

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
    // Soft rose/violet bloom drifting on the Nebula scene, glossy Aero surface.
    name: "Bloom",
    design: "aero",
    scene: "nebula",
    dark: { background: "#160b14", foreground: "#f6e9f1", accentFrom: "#f472b6", accentTo: "#a78bfa" },
    light: { background: "#fbeef5", foreground: "#2c1322", accentFrom: "#db2777", accentTo: "#7c5cf0" },
  },
  {
    // Warm coral-to-amber gradient over the morphing Mesh scene, chunky Clay.
    name: "Lagoon",
    design: "clay",
    scene: "mesh",
    dark: { background: "#0a1416", foreground: "#dff0ee", accentFrom: "#2dd4bf", accentTo: "#a3e635" },
    light: { background: "#e9f6f2", foreground: "#0c2622", accentFrom: "#0d9488", accentTo: "#65a30d" },
  },
  {
    // Terminal green linked nodes on the Constellation scene with a Bold surface.
    name: "Circuit",
    design: "bold",
    scene: "constellation",
    dark: { background: "#020806", foreground: "#d7f7e4", accentFrom: "#34d399", accentTo: "#22d3ee" },
    light: { background: "#e9f7ef", foreground: "#06231a", accentFrom: "#059669", accentTo: "#0891b2" },
  },
];

// An admin override of a built-in THEME_PACK, keyed by its `name`. The admin can
// recolor a built-in and swap its design/scene; resolveThemePacks() applies these
// on top of the built-ins. A pack with no override shows its built-in values; a
// reset removes the override.
export type ThemePackOverride = ThemePack;

// The names of the built-in packs the admin is allowed to override (others are
// ignored as stale). Exposed so the schema/editor can validate against them.
export const THEME_PACK_NAMES = THEME_PACKS.map((p) => p.name);

// Built-in packs with any admin overrides applied (matched by name, order
// preserved). Stale override names — e.g. a renamed built-in — are dropped.
export function resolveThemePacks(
  overrides: ThemePackOverride[] | undefined
): ThemePack[] {
  if (!overrides || overrides.length === 0) return THEME_PACKS;
  const byName = new Map(overrides.map((o) => [o.name, o]));
  return THEME_PACKS.map((p) => byName.get(p.name) ?? p);
}
