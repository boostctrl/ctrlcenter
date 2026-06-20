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
