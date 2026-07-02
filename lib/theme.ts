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
// soft gradient washes Aurora/Nebula already cover); stored references coerce
// back to the default via the schema catches / isSceneId guards.
export type SceneId =
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
  | "comets";

export const SCENES: { id: SceneId; name: string; description: string }[] = [
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
  { id: "peaks", name: "Peaks", description: "Layered mountain ridgelines in haze" },
  { id: "rain", name: "Rain", description: "Gentle streaks of falling accent rain" },
  { id: "fireflies", name: "Fireflies", description: "Wandering, softly pulsing lights" },
  { id: "blueprint", name: "Blueprint", description: "Drafting-paper grid with construction marks" },
  { id: "prisms", name: "Prisms", description: "Drifting translucent geometric shards" },
  { id: "petals", name: "Petals", description: "Cherry-blossom petals on the breeze" },
  { id: "comets", name: "Comets", description: "Shooting stars with fading trails" },
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
    light: { background: "#f3ead3", foreground: "#5c6a72", accentFrom: "#8da101", accentTo: "#35a77c" },
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
];

// An admin override of a built-in THEME_PACK. `key` pins it to a built-in (that
// pack's original name) so the editable `name` can differ — i.e. the admin can
// rename a theme. `key` is optional for back-compat: an override saved before
// renaming existed is matched by its `name` instead. resolveThemePacks() applies
// these over the built-ins; a reset removes the override.
export type ThemePackOverride = ThemePack & { key?: string };

// The names of the built-in packs the admin can override. Exposed so the
// schema/editor can validate against them.
export const THEME_PACK_NAMES = THEME_PACKS.map((p) => p.name);

// Built-in packs with any admin overrides applied (matched to a built-in by
// `key`, falling back to `name`; order preserved). The override's `name` becomes
// the display label, so renamed packs show their new name. Stale overrides that
// match no built-in are dropped.
export function resolveThemePacks(
  overrides: ThemePackOverride[] | undefined
): ThemePack[] {
  if (!overrides || overrides.length === 0) return THEME_PACKS;
  const byKey = new Map(overrides.map((o) => [o.key ?? o.name, o]));
  return THEME_PACKS.map((p) => byKey.get(p.name) ?? p);
}
