// Accent presets. The dashboard's accent (gradient heading, primary buttons,
// focus rings, background glow) is driven by the `--accent-from` / `--accent-to`
// CSS variables; each preset just supplies that pair. Using a fixed set of
// presets (rather than free-form color input) keeps the values sane and avoids
// injecting arbitrary user strings into inline styles.
export const ACCENTS = {
  violet: { from: "#a78bfa", to: "#22d3ee" },
  blue: { from: "#60a5fa", to: "#22d3ee" },
  emerald: { from: "#34d399", to: "#2dd4bf" },
  rose: { from: "#fb7185", to: "#f472b6" },
  amber: { from: "#fbbf24", to: "#fb7185" },
  cyan: { from: "#22d3ee", to: "#a78bfa" },
} as const;

export const ACCENT_KEYS = Object.keys(ACCENTS) as [Accent, ...Accent[]];

export type Accent = keyof typeof ACCENTS;

export function accentColors(accent: Accent) {
  return ACCENTS[accent] ?? ACCENTS.violet;
}

// Preset full themes for the theme builder — starting points a visitor can
// apply with one tap and then tweak. Each is the four colors that drive the
// custom-theme CSS variables (page background, ink/foreground, accent pair).
export type PresetTheme = {
  name: string;
  background: string;
  foreground: string;
  accentFrom: string;
  accentTo: string;
};

export const BASE_THEMES: PresetTheme[] = [
  { name: "Midnight", background: "#06070d", foreground: "#f4f4f6", accentFrom: "#a78bfa", accentTo: "#22d3ee" },
  { name: "Paper", background: "#f6f5f1", foreground: "#1c1b18", accentFrom: "#6366f1", accentTo: "#0ea5e9" },
  { name: "Nord", background: "#2e3440", foreground: "#e5e9f0", accentFrom: "#88c0d0", accentTo: "#81a1c1" },
  { name: "Forest", background: "#0c1410", foreground: "#e7f0e9", accentFrom: "#34d399", accentTo: "#2dd4bf" },
  { name: "Ember", background: "#140b0a", foreground: "#f6ece8", accentFrom: "#fb7185", accentTo: "#fbbf24" },
  { name: "Slate", background: "#0f1115", foreground: "#e6e8ec", accentFrom: "#60a5fa", accentTo: "#a78bfa" },
  { name: "Rosé", background: "#1a1016", foreground: "#f5e9f0", accentFrom: "#fb7185", accentTo: "#f472b6" },
  { name: "Sand", background: "#f4ecdf", foreground: "#2b2418", accentFrom: "#d97706", accentTo: "#f59e0b" },
];
