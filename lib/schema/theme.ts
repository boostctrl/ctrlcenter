// Site default theme, theme-pack overrides, and their admin inputs.
import { z } from "zod";
import { DESIGN_IDS, SCENE_IDS } from "../theme";
import { FONT_IDS, DEFAULT_FONT } from "../fonts";
import { hexColor } from "./shared";

// The site-wide default theme. Visitors can override every part of this in
// their own browser (the theme builder / settings page); these values are the
// baseline an un-customized visitor sees. `background`/`foreground` are optional
// custom default colors — when both are set they override the light/dark mode.
export const themeSchema = z.object({
  mode: z.enum(["system", "light", "dark"]).default("system"),
  // Name of the theme pack chosen as the site default (admin Settings). Purely a
  // UI pointer for the picker — the concrete design/scene/colors below are what
  // the layout/PrefsProvider actually apply.
  preset: z.string().optional(),
  // The pack chosen for an independent light-mode default (admin Settings). When
  // unset, light mode follows the dark default's light variant.
  presetLight: z.string().optional(),
  // `.catch` coerces an unknown id back to the default so a typo in a
  // hand-edited config doesn't fail the whole read. (Ids retired in 1.4 were
  // rewritten by the 3.0 migration, #305.)
  design: z.enum(DESIGN_IDS).catch("glass").default("glass"),
  scene: z.enum(SCENE_IDS).catch("aurora").default("aurora"),
  font: z.enum(FONT_IDS).catch(DEFAULT_FONT).default(DEFAULT_FONT),
  // Optional light-mode design/scene/font. When set, light mode uses a wholly
  // independent look; when omitted it falls back to the dark-mode values above.
  // `.catch` drops an unknown id, like the defaults above.
  designLight: z.enum(DESIGN_IDS).optional().catch(undefined),
  sceneLight: z.enum(SCENE_IDS).optional().catch(undefined),
  fontLight: z.enum(FONT_IDS).optional().catch(undefined),
  accentFrom: hexColor.default("#a78bfa"),
  accentTo: hexColor.default("#22d3ee"),
  // Optional light-mode accent pair. Only honored on the custom-colors path
  // below (a promoted theme carries per-mode accents, #142); when omitted,
  // light mode shares the accent above, as it always has.
  accentFromLight: hexColor.optional(),
  accentToLight: hexColor.optional(),
  // Optional custom default surface colors. `background`/`foreground` are the
  // dark-mode pair; `backgroundLight`/`foregroundLight` the light-mode pair.
  // Set together so the default look reads cohesively in both modes; light
  // falls back to the dark pair if omitted.
  background: hexColor.optional(),
  foreground: hexColor.optional(),
  backgroundLight: hexColor.optional(),
  foregroundLight: hexColor.optional(),
});

// A cohesive set of surface + accent colors (one mode of a theme).
export const colorSetSchema = z.object({
  background: hexColor,
  foreground: hexColor,
  accentFrom: hexColor,
  accentTo: hexColor,
});

// An admin override of a built-in theme pack, matched by `name`. Only edited
// packs are stored; resolveThemePacks() (lib/theme.ts) applies them over the
// built-ins and ignores any stale name. `name` is a plain string (not an enum)
// on purpose, so renaming a built-in in a future version can't make an existing
// config fail to load.
export const themePackSchema = z.object({
  // Stable id pinning this override to a built-in pack (its original name), so the
  // editable `name` below can differ. An override without one matches nothing
  // (the 3.0 migration gave the pre-1.9 key-less ones their name as key, #305).
  key: z.string().optional(),
  name: z.string().min(1),
  // `.catch` so an unknown design/scene id falls back to the default instead of
  // failing the whole config read.
  design: z.enum(DESIGN_IDS).catch("glass"),
  scene: z.enum(SCENE_IDS).catch("aurora"),
  dark: colorSetSchema,
  light: colorSetSchema,
});

// Admin sends the whole overrides array (PUT /api/themes); it replaces the
// stored `themes` wholesale, so resetting a pack just omits it.
export const themesInputSchema = z.array(themePackSchema);

export type ThemePackConfig = z.infer<typeof themePackSchema>;

// The admin sends the whole theme object (not a partial), so updateSettings
// replaces it wholesale — that's how clearing the optional custom colors works
// (omit them and they're gone). Required fields keep a saved theme well-formed.
export const themeInputSchema = z.object({
  mode: z.enum(["system", "light", "dark"]),
  preset: z.string().optional(),
  presetLight: z.string().optional(),
  design: z.enum(DESIGN_IDS),
  scene: z.enum(SCENE_IDS),
  font: z.enum(FONT_IDS),
  designLight: z.enum(DESIGN_IDS).optional(),
  sceneLight: z.enum(SCENE_IDS).optional(),
  fontLight: z.enum(FONT_IDS).optional(),
  accentFrom: hexColor,
  accentTo: hexColor,
  accentFromLight: hexColor.optional(),
  accentToLight: hexColor.optional(),
  background: hexColor.optional(),
  foreground: hexColor.optional(),
  backgroundLight: hexColor.optional(),
  foregroundLight: hexColor.optional(),
});
