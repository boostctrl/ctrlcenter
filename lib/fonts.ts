// Selectable UI fonts for the theme builder. Each is loaded via next/font in
// app/layout.tsx — which must import every face up front, since next/font is
// analyzed at build time and fonts can't be loaded dynamically by id — and
// exposes a CSS variable. A `font-<id>` class on <html> points --font-sans at
// that variable (see app/globals.css). "jakarta" is the app default and carries
// no class (it's the :root token).
//
// To add a font: load it in app/layout.tsx, add a `.font-<id>` rule in
// app/globals.css, and add an entry here — the inline pre-paint script
// interpolates FONT_IDS, so it picks the new id up automatically.
export type FontId =
  | "jakarta"
  | "inter"
  | "poppins"
  | "nunito"
  | "lora"
  | "jetbrains"
  | "outfit"
  | "grotesk"
  | "manrope"
  | "rubik"
  | "playfair"
  | "quicksand";

export const FONTS: { id: FontId; name: string }[] = [
  { id: "jakarta", name: "Plus Jakarta Sans" },
  { id: "inter", name: "Inter" },
  { id: "poppins", name: "Poppins" },
  { id: "nunito", name: "Nunito" },
  { id: "lora", name: "Lora" },
  { id: "jetbrains", name: "JetBrains Mono" },
  { id: "outfit", name: "Outfit" },
  { id: "grotesk", name: "Space Grotesk" },
  { id: "manrope", name: "Manrope" },
  { id: "rubik", name: "Rubik" },
  { id: "playfair", name: "Playfair Display" },
  { id: "quicksand", name: "Quicksand" },
];

export const FONT_IDS = FONTS.map((f) => f.id) as [FontId, ...FontId[]];

export const DEFAULT_FONT: FontId = "jakarta";

export function isFontId(v: unknown): v is FontId {
  return typeof v === "string" && (FONT_IDS as string[]).includes(v);
}

// The CSS variable a font id maps to (set by next/font in app/layout.tsx). Used
// for live previews in the theme builder.
export function fontVar(id: FontId): string {
  return `var(--font-${id})`;
}
