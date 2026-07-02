"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  detectTimezone,
  loadPrefs,
  savePrefs,
  loadActiveTheme,
  saveActiveTheme,
  loadThemes,
  saveThemes,
  loadAccentOverride,
  saveAccentOverride,
  loadDesign,
  saveDesign,
  loadScene,
  saveScene,
  loadFont,
  saveFont,
  loadFavorites,
  saveFavorites,
  type Units,
  type VisitorLocation,
  type VisitorPrefs,
  NO_ACCENT_OVERRIDES,
  type CustomTheme,
  type AccentColors,
  type AccentOverrides,
  type ModePair,
} from "@/lib/prefs";
import {
  DESIGN_IDS,
  SCENE_IDS,
  type ColorSet,
  type DesignId,
  type ModeColors,
  type SceneId,
  type ThemePack,
} from "@/lib/theme";
import { FONT_IDS, type FontId } from "@/lib/fonts";
import { deepenForLight } from "./scenes/color";

export type Theme = "system" | "light" | "dark";
// The two resolved appearance modes a theme part can be chosen for independently.
export type Mode = "dark" | "light";
export const THEME_KEY = "ctrlcenter:theme";

type Accent = AccentColors;

// Resolve whether the given mode renders dark right now ("system" follows the
// OS). Kept in sync with the no-flash inline script in app/layout.tsx.
function resolveDark(theme: Theme): boolean {
  if (typeof window === "undefined") return true;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return theme === "dark" || (theme === "system" && prefersDark);
}

function applyAccent(accent: Accent, dark: boolean): void {
  if (typeof document === "undefined") return;
  const s = document.documentElement.style;
  s.setProperty("--accent-from", accent.from);
  s.setProperty("--accent-to", accent.to);
  // Legible ink for content on the accent gradient (.btn-accent): near-black on
  // bright accents, white on dark ones, from the average luminance of the two
  // stops. Mirrors lm() in the no-flash script (app/layout.tsx).
  const accentLum = (luminance(accent.from) + luminance(accent.to)) / 2;
  s.setProperty("--accent-fg", accentLum >= 0.6 ? "#000000" : "#ffffff");
  // Scene backdrops read --scene-* so they can deepen + saturate the accent on
  // the near-white light surface (where the raw accent washes out) while keeping
  // it as-is on dark. Both modes are set explicitly so switching light→dark
  // clears any deepened value left on <html>.
  s.setProperty("--scene-from", dark ? accent.from : `rgb(${deepenForLight(accent.from)})`);
  s.setProperty("--scene-to", dark ? accent.to : `rgb(${deepenForLight(accent.to)})`);
}

// Swap the active design class on <html>. The default ("glass") uses the :root
// tokens and carries no class.
function applyDesign(design: DesignId): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  DESIGN_IDS.forEach((d) => el.classList.remove(`design-${d}`));
  if (design !== "glass") el.classList.add(`design-${design}`);
}

// Swap the active scene class on <html>. <SceneLayer> renders the matching
// backdrop/ornament components; the class lets any pure-CSS scene styling apply
// before hydration. The default ("aurora") carries no class.
function applyScene(scene: SceneId): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  SCENE_IDS.forEach((s) => el.classList.remove(`scene-${s}`));
  if (scene !== "aurora") el.classList.add(`scene-${scene}`);
}

// Swap the active font class on <html>, which repoints --font-sans. The default
// ("jakarta") uses the :root token and carries no class. See lib/fonts.ts.
function applyFont(font: FontId): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  FONT_IDS.forEach((f) => el.classList.remove(`font-${f}`));
  if (font !== "jakarta") el.classList.add(`font-${font}`);
}

// Perceived luminance (0–1) of a #rrggbb color; non-hex falls back to mid-gray.
function luminance(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Whether a surface color reads as light (so themed icons can pick a legible
// variant).
function isLightColor(hex: string): boolean {
  return luminance(hex) > 0.5;
}

// Resolve the effective accent: an explicit per-visitor override wins, then the
// active look's own accent, then the admin-configured default.
function resolveAccent(
  override: AccentColors | null,
  colors: ColorSet | null,
  fallback: Accent
): Accent {
  if (override) return override;
  if (colors) return { from: colors.accentFrom, to: colors.accentTo };
  return fallback;
}

// The accent override a mode contributes (overrides are chosen per mode).
function overrideFor(overrides: AccentOverrides, dark: boolean): AccentColors | null {
  return dark ? overrides.dark : overrides.light;
}

// The color set a look contributes for the resolved mode.
function variantFor(look: ModeColors | null, dark: boolean): ColorSet | null {
  if (!look) return null;
  return dark ? look.dark : look.light;
}

// Apply the whole theme state in one place. `.theme-light` ALWAYS tracks the
// resolved mode, so the light/dark toggle is always live. A look (visitor
// custom or admin default) contributes the surface colors for that mode;
// without one, the CSS defaults (`:root` dark / `.theme-light` light) apply. The
// accent is layered on last, so an accent-only override leaves the rest as-is.
function applyAll(opts: {
  theme: Theme;
  look: ModeColors | null;
  accentOverride: AccentOverrides;
  defaultAccent: Accent;
}): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  const s = el.style;
  const dark = resolveDark(opts.theme);
  el.classList.toggle("theme-light", !dark);
  const cs = variantFor(opts.look, dark);
  if (cs) {
    s.setProperty("--background", cs.background);
    s.setProperty("--foreground", cs.foreground);
    s.setProperty("--fg", cs.foreground);
  } else {
    s.removeProperty("--background");
    s.removeProperty("--foreground");
    s.removeProperty("--fg");
  }
  applyAccent(
    resolveAccent(overrideFor(opts.accentOverride, dark), cs, opts.defaultAccent),
    dark
  );
}

type EffectiveLocation = {
  latitude: number;
  longitude: number;
  label?: string;
  isDefault: boolean;
};

type PrefsValue = {
  timezone: string;
  units: Units;
  location: EffectiveLocation;
  detecting: boolean;
  locationError: string | null;
  weatherEnabled: boolean;
  greetingName: string;
  theme: Theme;
  // The appearance mode actually displayed now ("dark"/"light"). A live theme-
  // builder preview can make this differ from `theme` (the saved choice) without
  // persisting anything.
  resolvedMode: Mode;
  // Resolved for the current display mode (what's on <html> right now).
  design: DesignId;
  scene: SceneId;
  font: FontId;
  // Resolved design/scene/font for a specific mode — for the theme builder, whose
  // Editing toggle designs the non-displayed mode independently.
  designFor: (mode: Mode) => DesignId;
  sceneFor: (mode: Mode) => SceneId;
  fontFor: (mode: Mode) => FontId;
  // Whether the effective background reads as light (for theme-aware icons).
  surfaceIsLight: boolean;
  customThemes: CustomTheme[];
  // The active look's full light+dark pair, and the color set resolved for the
  // current mode (what the builder's pickers show).
  activeLook: ModeColors | null;
  activeColors: ColorSet | null;
  // Per-mode standalone accent overrides, and the accent resolved for the
  // current display mode.
  accentOverride: AccentOverrides;
  activeAccent: AccentColors;
  // Per-visitor pinned app IDs (pin order) and a toggle. Surfaced as a Favorites
  // row on the dashboard; client-only.
  favorites: string[];
  toggleFavorite: (id: string) => void;
  setTimezone: (tz: string) => void;
  setUnits: (units: Units) => void;
  setGreetingName: (name: string) => void;
  useMyLocation: () => void;
  setTheme: (theme: Theme) => void;
  // Preview a mode's appearance without persisting it (theme builder). Passing
  // null drops the preview and returns to the saved `theme`.
  setPreviewMode: (mode: Mode | null) => void;
  setDesign: (design: DesignId, mode: Mode) => void;
  setScene: (scene: SceneId, mode: Mode) => void;
  setFont: (font: FontId, mode: Mode) => void;
  applyPack: (pack: ThemePack, mode: Mode) => void;
  applyThemeColors: (colors: ModeColors, mode?: Mode) => void;
  setBaseColors: (
    background: string,
    foreground: string,
    targetDark?: boolean
  ) => void;
  // Set or clear one mode's standalone accent (light and dark are independent).
  setAccentOverride: (accent: AccentColors | null, mode: Mode) => void;
  saveNamedTheme: (name: string) => void;
  applyNamedTheme: (id: string) => void;
  deleteNamedTheme: (id: string) => void;
  clearCustomTheme: () => void;
  resetTheme: () => void;
  reset: () => void;
};

const PrefsContext = createContext<PrefsValue | null>(null);

export function useVisitorPrefs(): PrefsValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("useVisitorPrefs must be used within PrefsProvider");
  return ctx;
}

type Defaults = {
  timezone: string;
  latitude: number;
  longitude: number;
  units: Units;
};

// The admin-configured site default theme. Visitor choices override each part.
// The optional custom default colors are a cohesive light+dark pair (dark =
// `background`/`foreground`, light = `backgroundLight`/`foregroundLight`); when
// set they seed the surface for un-customized visitors in each mode. The accent
// pair is shared across both modes.
export type DefaultTheme = {
  mode: Theme;
  // The dark-mode design/scene/font; the optional `*Light` fields let the admin
  // set a wholly different look for light mode (falling back to the dark parts).
  design: DesignId;
  scene: SceneId;
  font: FontId;
  designLight?: DesignId;
  sceneLight?: SceneId;
  fontLight?: FontId;
  accentFrom: string;
  accentTo: string;
  background?: string;
  foreground?: string;
  backgroundLight?: string;
  foregroundLight?: string;
};

export function PrefsProvider({
  defaults,
  weatherEnabled,
  defaultTheme,
  children,
}: {
  defaults: Defaults;
  weatherEnabled: boolean;
  defaultTheme: DefaultTheme;
  children: ReactNode;
}) {
  // The admin default accent, and the admin custom default colors (a baseline
  // theme applied when the visitor hasn't customized colors or picked a mode).
  const defaultAccent: Accent = useMemo(
    () => ({ from: defaultTheme.accentFrom, to: defaultTheme.accentTo }),
    [defaultTheme.accentFrom, defaultTheme.accentTo]
  );
  // The admin custom default colors as a light+dark pair (accent shared). Light
  // falls back to the dark surface colors if the admin only set one mode.
  const adminLook: ModeColors | null = useMemo(() => {
    if (!defaultTheme.background || !defaultTheme.foreground) return null;
    const accentFrom = defaultTheme.accentFrom;
    const accentTo = defaultTheme.accentTo;
    return {
      dark: {
        background: defaultTheme.background,
        foreground: defaultTheme.foreground,
        accentFrom,
        accentTo,
      },
      light: {
        background: defaultTheme.backgroundLight ?? defaultTheme.background,
        foreground: defaultTheme.foregroundLight ?? defaultTheme.foreground,
        accentFrom,
        accentTo,
      },
    };
  }, [
    defaultTheme.background,
    defaultTheme.foreground,
    defaultTheme.backgroundLight,
    defaultTheme.foregroundLight,
    defaultTheme.accentFrom,
    defaultTheme.accentTo,
  ]);
  // Start empty so the first client render matches the server (which only knows
  // the admin defaults); detection/overrides are applied after mount.
  const [prefs, setPrefs] = useState<VisitorPrefs>({});
  const [detectedTz, setDetectedTz] = useState<string | undefined>();
  const [detecting, setDetecting] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(defaultTheme.mode);
  // Per-mode visitor overrides; a null per mode means "use the admin default".
  const [designs, setDesigns] = useState<ModePair<DesignId | null>>({
    dark: null,
    light: null,
  });
  const [scenes, setScenes] = useState<ModePair<SceneId | null>>({
    dark: null,
    light: null,
  });
  const [fonts, setFonts] = useState<ModePair<FontId | null>>({
    dark: null,
    light: null,
  });
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [activeLook, setActiveLook] = useState<ModeColors | null>(null);
  const [accentOverride, setAccentOverrideState] =
    useState<AccentOverrides>(NO_ACCENT_OVERRIDES);
  // Tracks the OS color scheme so "system" mode resolves its surface lightness.
  const [systemDark, setSystemDark] = useState(false);
  // A non-persisted appearance-mode preview for the theme builder: lets the
  // visitor see a mode while editing it without changing their saved choice.
  const [previewMode, setPreviewModeState] = useState<Mode | null>(null);
  // Pinned app IDs (starts empty to match SSR; hydrated from localStorage on mount).
  const [favorites, setFavorites] = useState<string[]>([]);

  // The mode actually shown on screen: a live builder preview overrides the
  // saved app mode (without persisting). Everything that drives the *display* —
  // the DOM classes/vars and the resolved design/scene/font — keys off this,
  // while persistence and the Preferences toggle still use the saved `theme`.
  const displayTheme: Theme = previewMode ?? theme;

  // The look to apply: a per-visitor custom look wins, otherwise the admin custom
  // default colors, otherwise null = the built-in light/dark CSS defaults. The
  // admin default carries BOTH a light and a dark variant, so the resolved mode
  // just selects the variant — a visitor picking a mode flips the variant rather
  // than discarding the admin default colors.
  const resolveLook = useCallback(
    (active: ModeColors | null): ModeColors | null => active ?? adminLook,
    [adminLook]
  );

  // The admin default design/scene/font for a mode: light falls back to the dark
  // part when the admin hasn't set a separate light value.
  const defDesign = useCallback(
    (dark: boolean): DesignId =>
      dark ? defaultTheme.design : defaultTheme.designLight ?? defaultTheme.design,
    [defaultTheme.design, defaultTheme.designLight]
  );
  const defScene = useCallback(
    (dark: boolean): SceneId =>
      dark ? defaultTheme.scene : defaultTheme.sceneLight ?? defaultTheme.scene,
    [defaultTheme.scene, defaultTheme.sceneLight]
  );
  const defFont = useCallback(
    (dark: boolean): FontId =>
      dark ? defaultTheme.font : defaultTheme.fontLight ?? defaultTheme.font,
    [defaultTheme.font, defaultTheme.fontLight]
  );

  // The effective design/scene/font for a mode: the visitor's per-mode choice,
  // else the admin default for that mode.
  const resolveDesign = useCallback(
    (dark: boolean): DesignId => (dark ? designs.dark : designs.light) ?? defDesign(dark),
    [designs, defDesign]
  );
  const resolveScene = useCallback(
    (dark: boolean): SceneId => (dark ? scenes.dark : scenes.light) ?? defScene(dark),
    [scenes, defScene]
  );
  const resolveFont = useCallback(
    (dark: boolean): FontId => (dark ? fonts.dark : fonts.light) ?? defFont(dark),
    [fonts, defFont]
  );

  // Apply the design/scene/font classes for whichever mode is displayed now.
  const applyChrome = useCallback(
    (dark: boolean) => {
      applyDesign(resolveDesign(dark));
      applyScene(resolveScene(dark));
      applyFont(resolveFont(dark));
    },
    [resolveDesign, resolveScene, resolveFont]
  );

  // A seeded color set for a mode when there's no active custom look yet, so
  // editing one mode never leaves the other mode's colors null.
  const seedColorSet = useCallback(
    (dark: boolean): ColorSet => {
      const a = resolveAccent(
        overrideFor(accentOverride, dark),
        variantFor(adminLook, dark),
        defaultAccent
      );
      const ad = adminLook ? (dark ? adminLook.dark : adminLook.light) : null;
      return {
        background: ad?.background ?? (dark ? "#06070d" : "#eceef3"),
        foreground: ad?.foreground ?? (dark ? "#f4f4f6" : "#181b24"),
        accentFrom: a.from,
        accentTo: a.to,
      };
    },
    [accentOverride, adminLook, defaultAccent]
  );

  const persist = useCallback((next: VisitorPrefs) => {
    setPrefs(next);
    savePrefs(next);
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      // Committing a real mode ends any live preview.
      setPreviewModeState(null);
      setThemeState(next);
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        // Private mode / quota — theme just won't persist.
      }
      // Picking a mode keeps the effective look (visitor custom, else admin
      // default); it just re-resolves to that look's matching light/dark variant
      // — and to that mode's own design/scene/font, which are independent.
      applyAll({
        theme: next,
        look: resolveLook(activeLook),
        accentOverride,
        defaultAccent,
      });
      applyChrome(resolveDark(next));
    },
    [activeLook, accentOverride, defaultAccent, resolveLook, applyChrome]
  );

  // Preview a mode's appearance live (theme builder) without persisting it, or
  // pass null to drop the preview and return to the saved mode. Only the display
  // changes — `theme` and localStorage are untouched, so leaving the page (which
  // clears this) reverts to the saved choice.
  const setPreviewMode = useCallback(
    (mode: Mode | null) => {
      setPreviewModeState(mode);
      const dt: Theme = mode ?? theme;
      applyAll({
        theme: dt,
        look: resolveLook(activeLook),
        accentOverride,
        defaultAccent,
      });
      applyChrome(resolveDark(dt));
    },
    [theme, activeLook, accentOverride, defaultAccent, resolveLook, applyChrome]
  );

  // Set one mode's design/scene/font. Persists the per-mode pair and applies the
  // class immediately only when that mode is the one currently displayed.
  const setDesign = useCallback(
    (next: DesignId, mode: Mode) => {
      const updated = { ...designs, [mode]: next };
      setDesigns(updated);
      saveDesign(updated);
      if ((mode === "dark") === resolveDark(displayTheme)) applyDesign(next);
    },
    [designs, displayTheme]
  );

  const setScene = useCallback(
    (next: SceneId, mode: Mode) => {
      const updated = { ...scenes, [mode]: next };
      setScenes(updated);
      saveScene(updated);
      if ((mode === "dark") === resolveDark(displayTheme)) applyScene(next);
    },
    [scenes, displayTheme]
  );

  const setFont = useCallback(
    (next: FontId, mode: Mode) => {
      const updated = { ...fonts, [mode]: next };
      setFonts(updated);
      saveFont(updated);
      if ((mode === "dark") === resolveDark(displayTheme)) applyFont(next);
    },
    [fonts, displayTheme]
  );

  // Apply (and persist) custom colors. With a `mode`, only that mode's colorset
  // is filled (from `colors[mode]`), leaving the other mode untouched — this is
  // how a preset fills just the mode being edited. Without a `mode`, both modes
  // are replaced (restoring a complete saved theme). The colorset carries its own
  // accent, so any standalone accent override is dropped in favor of it.
  const applyThemeColors = useCallback(
    (colors: ModeColors, mode?: Mode) => {
      let look: ModeColors;
      if (mode) {
        const base =
          activeLook ?? { dark: seedColorSet(true), light: seedColorSet(false) };
        look = { ...base, [mode]: colors[mode] };
      } else {
        look = colors;
      }
      setActiveLook(look);
      saveActiveTheme(look);
      setAccentOverrideState(NO_ACCENT_OVERRIDES);
      saveAccentOverride(null);
      applyAll({
        theme: displayTheme,
        look,
        accentOverride: NO_ACCENT_OVERRIDES,
        defaultAccent,
      });
    },
    [displayTheme, defaultAccent, activeLook, seedColorSet]
  );

  // Apply a curated pack to one mode: its design + scene + that mode's colorset.
  // (Font isn't part of a pack, so the mode's font is left as-is.)
  const applyPack = useCallback(
    (pack: ThemePack, mode: Mode) => {
      setDesign(pack.design, mode);
      setScene(pack.scene, mode);
      applyThemeColors({ dark: pack.dark, light: pack.light }, mode);
    },
    [setDesign, setScene, applyThemeColors]
  );

  // Update only the background/foreground for the CURRENT mode's variant,
  // leaving the accent and the other mode's variant as-is (live edit from the
  // theme builder's base-color pickers). With no active look yet, seed both
  // modes from the edit so the new look still has both.
  const setBaseColors = useCallback(
    (background: string, foreground: string, targetDark?: boolean) => {
      // Which mode's colorset to edit. Defaults to the displayed mode (the old
      // behavior); the theme builder passes an explicit target so it can design
      // the non-active mode without changing what the app shows.
      const dark = targetDark ?? resolveDark(displayTheme);
      const accent = resolveAccent(
        overrideFor(accentOverride, dark),
        variantFor(activeLook, dark),
        defaultAccent
      );
      const cs: ColorSet = {
        background,
        foreground,
        accentFrom: accent.from,
        accentTo: accent.to,
      };
      // With no custom look yet, seed each mode with ITS OWN defaults (admin
      // default colors, else the CSS :root / .theme-light values) so editing one
      // mode never overwrites the other.
      const base =
        activeLook ?? { dark: seedColorSet(true), light: seedColorSet(false) };
      const next: ModeColors = dark ? { ...base, dark: cs } : { ...base, light: cs };
      setActiveLook(next);
      saveActiveTheme(next);
      // Display follows the on-screen mode (the saved `theme`, or a live builder
      // preview), so editing the previewed mode shows immediately.
      applyAll({ theme: displayTheme, look: next, accentOverride, defaultAccent });
    },
    [displayTheme, defaultAccent, accentOverride, activeLook, seedColorSet]
  );

  // Set or clear one mode's accent on its own, leaving the background/foreground
  // (and the other mode's accent) as-is.
  const setAccentOverride = useCallback(
    (next: AccentColors | null, mode: Mode) => {
      const updated: AccentOverrides = { ...accentOverride, [mode]: next };
      setAccentOverrideState(updated);
      saveAccentOverride(updated);
      applyAll({
        theme: displayTheme,
        look: resolveLook(activeLook),
        accentOverride: updated,
        defaultAccent,
      });
    },
    [accentOverride, displayTheme, defaultAccent, activeLook, resolveLook]
  );

  // Capture the current full look — both modes' design/scene/font and colors —
  // as a saved theme, baking each mode's effective accent into its colorset so it
  // restores exactly as shown.
  const saveNamedTheme = useCallback(
    (name: string) => {
      const look =
        activeLook ?? { dark: seedColorSet(true), light: seedColorSet(false) };
      // Bake each mode's own effective accent into its colorset.
      const withAccent = (cs: ColorSet, dark: boolean): ColorSet => {
        const a = resolveAccent(overrideFor(accentOverride, dark), cs, defaultAccent);
        return { ...cs, accentFrom: a.from, accentTo: a.to };
      };
      const entry: CustomTheme = {
        id: crypto.randomUUID(),
        name: name.trim().slice(0, 40) || "Custom",
        design: resolveDesign(true),
        scene: resolveScene(true),
        font: resolveFont(true),
        designLight: resolveDesign(false),
        sceneLight: resolveScene(false),
        fontLight: resolveFont(false),
        dark: withAccent(look.dark, true),
        light: withAccent(look.light, false),
      };
      setCustomThemes((prev) => {
        const next = [...prev, entry];
        saveThemes(next);
        return next;
      });
    },
    [
      activeLook,
      seedColorSet,
      accentOverride,
      defaultAccent,
      resolveDesign,
      resolveScene,
      resolveFont,
    ]
  );

  // Restore a saved theme: both modes' design/scene/font and colors, then apply
  // the chrome for whichever mode is displayed now.
  const applyNamedTheme = useCallback(
    (id: string) => {
      const t = customThemes.find((x) => x.id === id);
      if (!t) return;
      const nextDesigns = { dark: t.design, light: t.designLight };
      const nextScenes = { dark: t.scene, light: t.sceneLight };
      const nextFonts = { dark: t.font, light: t.fontLight };
      setDesigns(nextDesigns);
      saveDesign(nextDesigns);
      setScenes(nextScenes);
      saveScene(nextScenes);
      setFonts(nextFonts);
      saveFont(nextFonts);
      applyThemeColors({ dark: t.dark, light: t.light });
      applyChrome(resolveDark(displayTheme));
    },
    [customThemes, applyThemeColors, applyChrome, displayTheme]
  );

  const deleteNamedTheme = useCallback((id: string) => {
    setCustomThemes((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveThemes(next);
      return next;
    });
  }, []);

  const clearCustomTheme = useCallback(() => {
    setActiveLook(null);
    saveActiveTheme(null);
    setAccentOverrideState(NO_ACCENT_OVERRIDES);
    saveAccentOverride(null);
    applyAll({
      theme: displayTheme,
      look: resolveLook(null),
      accentOverride: NO_ACCENT_OVERRIDES,
      defaultAccent,
    });
  }, [defaultAccent, displayTheme, resolveLook]);

  // Reset just the theme (colors, accent, design, scene, font — both modes) back
  // to the admin defaults, leaving mode/location/greeting alone — the theme
  // builder's own reset, distinct from the global `reset`.
  const resetTheme = useCallback(() => {
    setActiveLook(null);
    saveActiveTheme(null);
    setAccentOverrideState(NO_ACCENT_OVERRIDES);
    saveAccentOverride(null);
    saveDesign(null);
    saveScene(null);
    saveFont(null);
    setDesigns({ dark: null, light: null });
    setScenes({ dark: null, light: null });
    setFonts({ dark: null, light: null });
    applyAll({
      theme: displayTheme,
      look: resolveLook(null),
      accentOverride: NO_ACCENT_OVERRIDES,
      defaultAccent,
    });
    const dark = resolveDark(displayTheme);
    applyDesign(defDesign(dark));
    applyScene(defScene(dark));
    applyFont(defFont(dark));
  }, [defaultAccent, displayTheme, resolveLook, defDesign, defScene, defFont]);

  // Load the stored theme + custom themes on mount and keep "system" in sync
  // with OS changes. Anything the visitor hasn't set falls back to the admin
  // default theme.
  useEffect(() => {
    let stored: Theme = defaultTheme.mode;
    try {
      const raw = window.localStorage.getItem(THEME_KEY);
      if (raw === "light" || raw === "dark" || raw === "system") {
        stored = raw;
      }
    } catch {
      // ignore
    }
    const active = loadActiveTheme();
    const overrideAccent = loadAccentOverride();
    const storedDesigns = loadDesign();
    const storedScenes = loadScene();
    const storedFonts = loadFont();
    // Resolve a mode's design/scene/font from the loaded pairs + admin defaults
    // (the state isn't committed yet, so resolve from the raw values here).
    const chromeFor = (dark: boolean) => ({
      design: (dark ? storedDesigns.dark : storedDesigns.light) ?? defDesign(dark),
      scene: (dark ? storedScenes.dark : storedScenes.light) ?? defScene(dark),
      font: (dark ? storedFonts.dark : storedFonts.light) ?? defFont(dark),
    });
    /* eslint-disable react-hooks/set-state-in-effect */
    setThemeState(stored);
    setDesigns(storedDesigns);
    setScenes(storedScenes);
    setFonts(storedFonts);
    setActiveLook(active);
    setAccentOverrideState(overrideAccent);
    setCustomThemes(loadThemes());
    setSystemDark(
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
    /* eslint-enable react-hooks/set-state-in-effect */
    // The inline script already applied these; re-apply for consistency.
    applyAll({
      theme: stored,
      look: resolveLook(active),
      accentOverride: overrideAccent,
      defaultAccent,
    });
    const initial = chromeFor(resolveDark(stored));
    applyDesign(initial.design);
    applyScene(initial.scene);
    applyFont(initial.font);

    // Re-apply on OS scheme change. Only "system" mode tracks the OS — but the
    // look AND the design/scene/font are mode-aware, so "system" must re-resolve
    // all of them when the OS flips light/dark.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setSystemDark(mq.matches);
      let raw: string | null = null;
      try {
        raw = window.localStorage.getItem(THEME_KEY);
      } catch {
        // ignore
      }
      const isMode = raw === "light" || raw === "dark" || raw === "system";
      const mode: Theme = isMode ? (raw as Theme) : defaultTheme.mode;
      if (mode !== "system") return;
      const look = resolveLook(loadActiveTheme());
      applyAll({
        theme: "system",
        look,
        accentOverride: loadAccentOverride(),
        defaultAccent,
      });
      const next = chromeFor(mq.matches);
      applyDesign(next.design);
      applyScene(next.scene);
      applyFont(next.font);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
    // Mount-only: the admin default theme is stable server-provided data;
    // re-running this on a new prop identity would clobber live theme state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount: load stored prefs, silently detect timezone, and IP-detect the
  // location on a first visit (no stored location, not previously reset).
  useEffect(() => {
    const stored = loadPrefs();
    // Deliberately hydrate from client-only sources (localStorage, Intl) after
    // mount: starting empty keeps the first client render identical to the SSR
    // output, so this is the correct place to apply them despite the lint rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs(stored);
    setDetectedTz(detectTimezone());
    setFavorites(loadFavorites());

    // Location only matters for weather; skip the IP lookup entirely when the
    // weather widget is off, or once the visitor has set/reset their location.
    if (!weatherEnabled || stored.location || stored.dismissedAuto) return;
    let active = true;
    setDetecting(true);
    fetch("https://ipwho.is/?fields=success,latitude,longitude,city,country_code")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d?.success && typeof d.latitude === "number") {
          const label = d.city
            ? `${d.city}${d.country_code ? `, ${d.country_code}` : ""}`
            : undefined;
          const location: VisitorLocation = {
            latitude: d.latitude,
            longitude: d.longitude,
            label,
            source: "ip",
          };
          persist({ ...stored, location });
        }
      })
      .catch(() => {})
      .finally(() => active && setDetecting(false));
    return () => {
      active = false;
    };
  }, [persist, weatherEnabled]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      saveFavorites(next);
      return next;
    });
  }, []);

  const setTimezone = useCallback(
    (tz: string) => persist({ ...prefs, timezone: tz || undefined }),
    [prefs, persist]
  );

  const setUnits = useCallback(
    (units: Units) => persist({ ...prefs, units }),
    [prefs, persist]
  );

  const setGreetingName = useCallback(
    (name: string) =>
      persist({ ...prefs, greetingName: name.trim() ? name.slice(0, 60) : undefined }),
    [prefs, persist]
  );

  const reset = useCallback(() => {
    // Clear overrides and remember the reset so auto IP-detection won't re-run.
    persist({ dismissedAuto: true });
    // Drop all theme customizations so the visitor falls back to the admin
    // default theme (mode, design, colors, accent).
    try {
      window.localStorage.removeItem(THEME_KEY);
    } catch {
      // ignore
    }
    saveActiveTheme(null);
    saveAccentOverride(null);
    saveDesign(null);
    saveScene(null);
    saveFont(null);
    setActiveLook(null);
    setAccentOverrideState(NO_ACCENT_OVERRIDES);
    setThemeState(defaultTheme.mode);
    setDesigns({ dark: null, light: null });
    setScenes({ dark: null, light: null });
    setFonts({ dark: null, light: null });
    applyAll({
      theme: defaultTheme.mode,
      look: adminLook,
      accentOverride: NO_ACCENT_OVERRIDES,
      defaultAccent,
    });
    const dark = resolveDark(defaultTheme.mode);
    applyDesign(defDesign(dark));
    applyScene(defScene(dark));
    applyFont(defFont(dark));
  }, [
    persist,
    defaultTheme.mode,
    defDesign,
    defScene,
    defFont,
    adminLook,
    defaultAccent,
  ]);

  const useMyLocation = useCallback(() => {
    setLocationError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationError("This browser doesn't support location.");
      return;
    }
    // Geolocation only works in a secure context (HTTPS or localhost). This app
    // is often self-hosted over plain HTTP on a LAN, where the call fails
    // silently — so say so up front rather than spin forever.
    if (!window.isSecureContext) {
      setLocationError(
        "Location needs a secure (HTTPS) connection. Set it manually instead."
      );
      return;
    }
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let label: string | undefined;
        try {
          const r = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
          );
          const d = await r.json();
          label = d.city || d.locality || undefined;
        } catch {
          // No label is fine; coordinates still drive the weather.
        }
        persist({
          ...prefs,
          location: { latitude, longitude, label, source: "device" },
        });
        setDetecting(false);
      },
      (err) => {
        setDetecting(false);
        setLocationError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied."
            : err.code === err.TIMEOUT
              ? "Location request timed out."
              : "Couldn't get your location."
        );
      },
      // A generous timeout: the countdown includes the time the permission
      // prompt is open, so a short one often "times out" before the visitor has
      // even answered.
      { enableHighAccuracy: false, timeout: 30000, maximumAge: 600000 }
    );
  }, [prefs, persist]);

  const value = useMemo<PrefsValue>(() => {
    const timezone = prefs.timezone || detectedTz || defaults.timezone;
    const units = prefs.units || defaults.units;
    // Resolve the displayed mode (saved `theme`, or a live builder preview) to a
    // lightness, then pick the effective look's matching variant (visitor look,
    // else admin default colors). That variant's background drives the surface-
    // lightness used by theme-aware icons/scenes.
    const isLight =
      displayTheme === "light" || (displayTheme === "system" && !systemDark);
    const displayDark = !isLight;
    const effectiveLook = activeLook ?? adminLook;
    const activeColors: ColorSet | null = effectiveLook
      ? isLight
        ? effectiveLook.light
        : effectiveLook.dark
      : null;
    const surfaceIsLight = activeColors
      ? isLightColor(activeColors.background)
      : isLight;
    const location: EffectiveLocation = prefs.location
      ? {
          latitude: prefs.location.latitude,
          longitude: prefs.location.longitude,
          label: prefs.location.label,
          isDefault: false,
        }
      : {
          latitude: defaults.latitude,
          longitude: defaults.longitude,
          isDefault: true,
        };
    return {
      timezone,
      units,
      location,
      detecting,
      locationError,
      weatherEnabled,
      greetingName: prefs.greetingName ?? "",
      theme,
      resolvedMode: displayDark ? "dark" : "light",
      design: resolveDesign(displayDark),
      scene: resolveScene(displayDark),
      font: resolveFont(displayDark),
      designFor: (mode: Mode) => resolveDesign(mode === "dark"),
      sceneFor: (mode: Mode) => resolveScene(mode === "dark"),
      fontFor: (mode: Mode) => resolveFont(mode === "dark"),
      surfaceIsLight,
      customThemes,
      activeLook,
      activeColors,
      accentOverride,
      activeAccent: resolveAccent(
        overrideFor(accentOverride, displayDark),
        activeColors,
        defaultAccent
      ),
      favorites,
      toggleFavorite,
      setTimezone,
      setUnits,
      setGreetingName,
      useMyLocation,
      setTheme,
      setPreviewMode,
      setDesign,
      setScene,
      setFont,
      applyPack,
      applyThemeColors,
      setBaseColors,
      setAccentOverride,
      saveNamedTheme,
      applyNamedTheme,
      deleteNamedTheme,
      clearCustomTheme,
      resetTheme,
      reset,
    };
  }, [
    prefs,
    detectedTz,
    defaults,
    detecting,
    locationError,
    weatherEnabled,
    defaultAccent,
    adminLook,
    theme,
    displayTheme,
    resolveDesign,
    resolveScene,
    resolveFont,
    systemDark,
    customThemes,
    activeLook,
    accentOverride,
    favorites,
    toggleFavorite,
    setTimezone,
    setUnits,
    setGreetingName,
    useMyLocation,
    setTheme,
    setPreviewMode,
    setDesign,
    setScene,
    setFont,
    applyPack,
    applyThemeColors,
    setBaseColors,
    setAccentOverride,
    saveNamedTheme,
    applyNamedTheme,
    deleteNamedTheme,
    clearCustomTheme,
    resetTheme,
    reset,
  ]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}
