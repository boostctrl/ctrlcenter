import { DESIGNS } from "@/lib/theme";
import type { DesignId } from "@/lib/theme";
import type { ThemeColors } from "@/lib/prefs";

export const DESIGN_NAMES = Object.fromEntries(
  DESIGNS.map((d) => [d.id, d.name])
) as Record<DesignId, string>;

export const DEFAULT_DRAFT: ThemeColors = {
  background: "#06070d",
  foreground: "#f4f4f6",
  accentFrom: "#a78bfa",
  accentTo: "#22d3ee",
};

// Surface defaults per mode (mirror the :root / .theme-light CSS), used to seed
// the pickers when editing a mode that has no custom colors yet.
export const MODE_DEFAULTS: Record<"dark" | "light", { background: string; foreground: string }> = {
  dark: { background: "#06070d", foreground: "#f4f4f6" },
  light: { background: "#eceef3", foreground: "#181b24" },
};

export const BASE_FIELDS: { key: "background" | "foreground"; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text & surfaces" },
];

// The builder's sections, one per tab. Tabs keep the five option grids from
// stacking into one endless scroll — you see one grid at a time, while the
// header (mode switch) and footer (save/reset) stay put around them.
export const TABS = [
  { id: "themes", name: "Themes" },
  { id: "colors", name: "Colors" },
  { id: "design", name: "Design" },
  { id: "tune", name: "Tune" },
  { id: "scene", name: "Scene" },
  { id: "font", name: "Font" },
] as const;
export type TabId = (typeof TABS)[number]["id"];
