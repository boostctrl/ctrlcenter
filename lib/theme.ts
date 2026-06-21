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
