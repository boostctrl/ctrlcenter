// Site default theme, theme-pack overrides, and their admin inputs.
import { z } from "zod";
import {
  DENSITY_IDS,
  DESIGN_IDS,
  MAX_WALLPAPER_BLUR,
  MOTION_IDS,
  SCENE_IDS,
  SEMANTIC_KEYS,
  TUNE_FIELDS,
  WALLPAPER_FIT_IDS,
  isWallpaperSrc,
} from "../theme";
import { FONT_IDS, DEFAULT_FONT } from "../fonts";
import { hexColor } from "./shared";

// A fine-tune over the design (#326): each knob a whole percentage of the
// design's own value, 100 = untouched. Every knob is required so a stored
// tune is always complete; lib/prefs.ts sanitizeTune fills a partial one.
export const tuneSchema = z.object(
  Object.fromEntries(
    TUNE_FIELDS.map((f) => [f.key, z.number().int().min(0).max(f.max)])
  ) as Record<(typeof TUNE_FIELDS)[number]["key"], z.ZodNumber>
);

export type TuneConfig = z.infer<typeof tuneSchema>;

// A theme's semantic colors (#331): up, down, warning, info, all required.
export const semanticSchema = z.object(
  Object.fromEntries(SEMANTIC_KEYS.map((k) => [k, hexColor])) as Record<
    (typeof SEMANTIC_KEYS)[number],
    typeof hexColor
  >
);

// A wallpaper (#333): an image behind the scene with blur, dim and fit.
export const wallpaperSchema = z.object({
  src: z.string().refine(isWallpaperSrc, "an https:// URL or a same-origin path"),
  blur: z.number().int().min(0).max(MAX_WALLPAPER_BLUR).default(0),
  dim: z.number().int().min(0).max(100).default(0),
  fit: z.enum(WALLPAPER_FIT_IDS).default("cover"),
});

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
  // Optional fine-tune over the design, per mode (light falls back to the
  // dark tune). Absent = the design untouched.
  tune: tuneSchema.optional(),
  tuneLight: tuneSchema.optional(),
  // Optional scene effects (#327), per mode: the backdrop's intensity (0–100)
  // and motion. Absent = as the scene is designed.
  sceneIntensity: z.number().int().min(0).max(100).optional(),
  sceneMotion: z.enum(MOTION_IDS).optional(),
  sceneIntensityLight: z.number().int().min(0).max(100).optional(),
  sceneMotionLight: z.enum(MOTION_IDS).optional(),
  // Typography (#330): a heading font (absent = the body font) and the
  // layout density, per mode (light falls back to dark).
  headingFont: z.enum(FONT_IDS).optional().catch(undefined),
  headingFontLight: z.enum(FONT_IDS).optional().catch(undefined),
  density: z.enum(DENSITY_IDS).optional().catch(undefined),
  densityLight: z.enum(DENSITY_IDS).optional().catch(undefined),
  // Optional semantic colors (#331), per mode (light falls back to dark).
  status: semanticSchema.optional().catch(undefined),
  statusLight: semanticSchema.optional().catch(undefined),
  // An optional wallpaper (#333), per mode (light falls back to dark).
  wallpaper: wallpaperSchema.optional().catch(undefined),
  wallpaperLight: wallpaperSchema.optional().catch(undefined),
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
  // A pack may ship a tune over its design (#326), and fonts (#330).
  tune: tuneSchema.optional(),
  font: z.enum(FONT_IDS).optional().catch(undefined),
  headingFont: z.enum(FONT_IDS).optional().catch(undefined),
  status: semanticSchema.optional().catch(undefined),
  statusLight: semanticSchema.optional().catch(undefined),
  wallpaper: wallpaperSchema.optional().catch(undefined),
  wallpaperLight: wallpaperSchema.optional().catch(undefined),
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
  tune: tuneSchema.optional(),
  tuneLight: tuneSchema.optional(),
  sceneIntensity: z.number().int().min(0).max(100).optional(),
  sceneMotion: z.enum(MOTION_IDS).optional(),
  sceneIntensityLight: z.number().int().min(0).max(100).optional(),
  sceneMotionLight: z.enum(MOTION_IDS).optional(),
  headingFont: z.enum(FONT_IDS).optional(),
  headingFontLight: z.enum(FONT_IDS).optional(),
  density: z.enum(DENSITY_IDS).optional(),
  densityLight: z.enum(DENSITY_IDS).optional(),
  status: semanticSchema.optional(),
  statusLight: semanticSchema.optional(),
  wallpaper: wallpaperSchema.optional(),
  wallpaperLight: wallpaperSchema.optional(),
});
