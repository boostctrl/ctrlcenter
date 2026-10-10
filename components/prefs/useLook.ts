"use client";

// The visitor's look (#290 split from PrefsProvider): appearance mode, the
// per-mode design/scene/font, custom colors and accents, saved themes, and
// the DOM application of all of it. PrefsProvider exposes the result as its
// own context (useLookPrefs), so a color change doesn't re-render consumers
// that only read the location or favorites.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadActiveTheme,
  saveActiveTheme,
  loadThemes,
  loadAccentOverride,
  saveAccentOverride,
  loadDesign,
  saveDesign,
  loadScene,
  saveScene,
  loadFont,
  saveFont,
  loadTune,
  saveTune,
  loadSceneFx,
  saveSceneFx,
  loadReduceMotion,
  saveReduceMotion,
  loadHeadingFont,
  saveHeadingFont,
  loadDensity,
  saveDensity,
  NO_ACCENT_OVERRIDES,
  type HeadingChoice,
  type CustomTheme,
  type AccentColors,
  type AccentOverrides,
  type ModePair,
} from "@/lib/prefs";
import type { ColorSet, Density, DesignId, ModeColors, MotionLevel, SceneFx, SceneId, ThemePack, Tune } from "@/lib/theme";
import type { FontId } from "@/lib/fonts";
import {
  applyAll as paintAll,
  applyDesign,
  applyFont,
  applyHeadingFont,
  applyScene,
  isLightColor,
  overrideFor,
  resolveAccent,
  resolveDark,
  variantFor,
  type Accent,
  type Mode,
  type Theme,
} from "./themeApply";
import { useSavedThemes } from "./useSavedThemes";

export const THEME_KEY = "ctrlcenter:theme";

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
  accentFromLight?: string;
  accentToLight?: string;
  background?: string;
  foreground?: string;
  backgroundLight?: string;
  foregroundLight?: string;
  // The site default's fine-tune over the design, per mode (#326).
  tune?: Tune;
  tuneLight?: Tune;
  // The site default's scene effects, per mode (#327).
  sceneIntensity?: number;
  sceneMotion?: MotionLevel;
  sceneIntensityLight?: number;
  sceneMotionLight?: MotionLevel;
  // The site default's heading font and density, per mode (#330).
  headingFont?: FontId;
  headingFontLight?: FontId;
  density?: Density;
  densityLight?: Density;
};

export type LookValue = {
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
  // The effective fine-tune for a mode (visitor's, else the admin default),
  // or null when the design is untouched (#326).
  tuneFor: (mode: Mode) => Tune | null;
  // The effective scene effects for a mode (visitor's, else the admin
  // default), or null when the scene is as designed (#327).
  sceneFxFor: (mode: Mode) => SceneFx | null;
  // The effective colors for a mode — the active look's variant (else the
  // admin default, else the stock colors) with that mode's accent override
  // applied — so the builder can tell which theme or palette is active (#328).
  colorsFor: (mode: Mode) => ColorSet;
  // The effective heading font for a mode (null = the body font) and the
  // density (#330).
  headingFontFor: (mode: Mode) => FontId | null;
  densityFor: (mode: Mode) => Density;
  // The visitor's Reduce motion switch, and the motion level the scenes run
  // at now: "off" when the switch is on, else the displayed mode's effects.
  reduceMotion: boolean;
  motion: MotionLevel;
  // True once the stored look (saved themes included) has been read on
  // mount, so a consumer that writes the saved list from a link (#329) can
  // wait for it rather than clobber it with the empty SSR state.
  hydrated: boolean;
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
  setTheme: (theme: Theme) => void;
  // Preview a mode's appearance without persisting it (theme builder). Passing
  // null drops the preview and returns to the saved `theme`.
  setPreviewMode: (mode: Mode | null) => void;
  setDesign: (design: DesignId, mode: Mode) => void;
  setScene: (scene: SceneId, mode: Mode) => void;
  setFont: (font: FontId, mode: Mode) => void;
  // Set (or, with null, clear back to the admin default) a mode's fine-tune.
  setTune: (tune: Tune | null, mode: Mode) => void;
  setSceneFx: (fx: SceneFx | null, mode: Mode) => void;
  setReduceMotion: (reduce: boolean) => void;
  // A heading font for a mode: a face, "body" (follow the body font, even
  // over an admin default heading face), or null (not chosen).
  setHeadingFont: (font: HeadingChoice | null, mode: Mode) => void;
  setDensity: (density: Density | null, mode: Mode) => void;
  applyPack: (pack: ThemePack, mode: Mode) => void;
  applyThemeColors: (colors: ModeColors, mode?: Mode) => void;
  setBaseColors: (
    background: string,
    foreground: string,
    targetDark?: boolean
  ) => void;
  // Set or clear one mode's standalone accent (light and dark are independent).
  setAccentOverride: (accent: AccentColors | null, mode: Mode) => void;
  // Returns false when the theme couldn't be persisted (storage unavailable).
  // With `overwriteId`, replaces that saved theme in place (same id and list
  // position) instead of appending a second copy.
  saveNamedTheme: (name: string, overwriteId?: string) => boolean;
  applyNamedTheme: (id: string) => void;
  // The current look as a theme object under `name`, without saving it — for
  // "Copy as code" (#329).
  captureTheme: (name: string, id: string) => CustomTheme;
  // Save (unless already saved) and apply a theme from a code or link; null
  // when it couldn't be stored.
  adoptTheme: (theme: CustomTheme) => CustomTheme | null;
  // Rename a saved theme in place. Returns false for an empty name, an unknown
  // id, or a failed write.
  renameNamedTheme: (id: string, name: string) => boolean;
  deleteNamedTheme: (id: string) => void;
  // Append already-sanitized imported themes, skipping any that duplicate an
  // existing or just-imported one. Returns the number added (0 when all were
  // duplicates), or null when the write couldn't be persisted.
  importNamedThemes: (themes: CustomTheme[]) => number | null;
  clearCustomTheme: () => void;
  resetTheme: () => void;
};

// All look state for `defaultTheme`. `resetLook` drops every customization,
// mode included (the theme half of the global reset).
export function useLook(defaultTheme: DefaultTheme): {
  look: LookValue;
  resetLook: () => void;
} {
  // The admin default accent, and the admin custom default colors (a baseline
  // theme applied when the visitor hasn't customized colors or picked a mode).
  const defaultAccent: Accent = useMemo(
    () => ({ from: defaultTheme.accentFrom, to: defaultTheme.accentTo }),
    [defaultTheme.accentFrom, defaultTheme.accentTo]
  );
  // The admin custom default colors as a light+dark pair. Light falls back to
  // the dark surface colors — and to the shared accent, unless the default
  // theme carries its own light accents (a promoted theme does, #142).
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
        accentFrom: defaultTheme.accentFromLight ?? accentFrom,
        accentTo: defaultTheme.accentToLight ?? accentTo,
      },
    };
  }, [
    defaultTheme.background,
    defaultTheme.foreground,
    defaultTheme.backgroundLight,
    defaultTheme.foregroundLight,
    defaultTheme.accentFrom,
    defaultTheme.accentTo,
    defaultTheme.accentFromLight,
    defaultTheme.accentToLight,
  ]);
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
  const [tunes, setTunes] = useState<ModePair<Tune | null>>({
    dark: null,
    light: null,
  });
  const [sceneFxs, setSceneFxs] = useState<ModePair<SceneFx | null>>({
    dark: null,
    light: null,
  });
  const [reduceMotion, setReduceMotionState] = useState(false);
  const [headings, setHeadings] = useState<ModePair<HeadingChoice | null>>({
    dark: null,
    light: null,
  });
  const [densities, setDensities] = useState<ModePair<Density | null>>({
    dark: null,
    light: null,
  });
  const [hydrated, setHydrated] = useState(false);
  const [activeLook, setActiveLook] = useState<ModeColors | null>(null);
  const [accentOverride, setAccentOverrideState] =
    useState<AccentOverrides>(NO_ACCENT_OVERRIDES);
  // Tracks the OS color scheme so "system" mode resolves its surface lightness.
  const [systemDark, setSystemDark] = useState(false);
  // A non-persisted appearance-mode preview for the theme builder: lets the
  // visitor see a mode while editing it without changing their saved choice.
  const [previewMode, setPreviewModeState] = useState<Mode | null>(null);

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
  const defTune = useCallback(
    (dark: boolean): Tune | null =>
      (dark ? defaultTheme.tune : defaultTheme.tuneLight ?? defaultTheme.tune) ?? null,
    [defaultTheme.tune, defaultTheme.tuneLight]
  );
  // The admin default heading font / density for a mode (light falls back
  // to dark). A heading of null means the body font.
  const defHeading = useCallback(
    (dark: boolean): FontId | null =>
      (dark ? defaultTheme.headingFont : defaultTheme.headingFontLight ?? defaultTheme.headingFont) ?? null,
    [defaultTheme.headingFont, defaultTheme.headingFontLight]
  );
  const defDensity = useCallback(
    (dark: boolean): Density =>
      (dark ? defaultTheme.density : defaultTheme.densityLight ?? defaultTheme.density) ?? "comfortable",
    [defaultTheme.density, defaultTheme.densityLight]
  );
  // The admin default scene effects for a mode: light falls back to dark per
  // field; null when neither field is set.
  const defSceneFx = useCallback(
    (dark: boolean): SceneFx | null => {
      const intensity = dark
        ? defaultTheme.sceneIntensity
        : defaultTheme.sceneIntensityLight ?? defaultTheme.sceneIntensity;
      const motion = dark
        ? defaultTheme.sceneMotion
        : defaultTheme.sceneMotionLight ?? defaultTheme.sceneMotion;
      if (intensity === undefined && motion === undefined) return null;
      return { intensity: intensity ?? 100, motion: motion ?? "normal" };
    },
    [
      defaultTheme.sceneIntensity,
      defaultTheme.sceneMotion,
      defaultTheme.sceneIntensityLight,
      defaultTheme.sceneMotionLight,
    ]
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
  const resolveTune = useCallback(
    (dark: boolean): Tune | null => (dark ? tunes.dark : tunes.light) ?? defTune(dark),
    [tunes, defTune]
  );
  const resolveSceneFx = useCallback(
    (dark: boolean): SceneFx | null => (dark ? sceneFxs.dark : sceneFxs.light) ?? defSceneFx(dark),
    [sceneFxs, defSceneFx]
  );
  // The heading font: the visitor's choice ("body" = none, over the admin
  // default), else the admin default.
  const resolveHeading = useCallback(
    (dark: boolean): FontId | null => {
      const v = dark ? headings.dark : headings.light;
      if (v === "body") return null;
      return v ?? defHeading(dark);
    },
    [headings, defHeading]
  );
  const resolveDensity = useCallback(
    (dark: boolean): Density => (dark ? densities.dark : densities.light) ?? defDensity(dark),
    [densities, defDensity]
  );

  // Paint the look state, with the fine-tune, scene effects and Reduce motion
  // switch resolved for the mode it shows unless the caller passes one
  // explicitly (an edit paints its new value before the state commits).
  const applyAll = useCallback(
    (opts: Parameters<typeof paintAll>[0]) => {
      const dark = resolveDark(opts.theme);
      paintAll({
        tune: resolveTune(dark),
        sceneFx: resolveSceneFx(dark),
        reduceMotion,
        density: resolveDensity(dark),
        ...opts,
      });
    },
    [resolveTune, resolveSceneFx, reduceMotion, resolveDensity]
  );

  // Apply the design/scene/font/heading classes for whichever mode is
  // displayed now.
  const applyChrome = useCallback(
    (dark: boolean) => {
      applyDesign(resolveDesign(dark));
      applyScene(resolveScene(dark));
      applyFont(resolveFont(dark));
      applyHeadingFont(resolveHeading(dark));
    },
    [resolveDesign, resolveScene, resolveFont, resolveHeading]
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
    [activeLook, accentOverride, defaultAccent, resolveLook, applyChrome, applyAll]
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
    [theme, activeLook, accentOverride, defaultAccent, resolveLook, applyChrome, applyAll]
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
    [displayTheme, defaultAccent, activeLook, seedColorSet, applyAll]
  );

  // Set (or clear) one mode's fine-tune over its design. Persists the per-mode
  // pair and repaints only when that mode is the one on screen, with the new
  // value passed explicitly so the paint doesn't wait for the state to commit.
  const setTune = useCallback(
    (next: Tune | null, mode: Mode) => {
      setTunes((prev) => {
        const updated = { ...prev, [mode]: next };
        saveTune(updated);
        return updated;
      });
      const dark = resolveDark(displayTheme);
      if ((mode === "dark") === dark) {
        applyAll({
          theme: displayTheme,
          look: resolveLook(activeLook),
          accentOverride,
          defaultAccent,
          tune: next ?? defTune(dark),
        });
      }
    },
    [displayTheme, resolveLook, activeLook, accentOverride, defaultAccent, defTune, applyAll]
  );

  // Set one mode's heading font (a face, "body", or null to fall back to the
  // admin default); the class swaps only when that mode is on screen.
  const setHeadingFont = useCallback(
    (next: HeadingChoice | null, mode: Mode) => {
      setHeadings((prev) => {
        const updated = { ...prev, [mode]: next };
        saveHeadingFont(updated);
        return updated;
      });
      const dark = resolveDark(displayTheme);
      if ((mode === "dark") === dark) {
        applyHeadingFont(next === "body" ? null : (next ?? defHeading(dark)));
      }
    },
    [displayTheme, defHeading]
  );

  // Set (or clear) one mode's density, painting its factor when on screen.
  const setDensity = useCallback(
    (next: Density | null, mode: Mode) => {
      setDensities((prev) => {
        const updated = { ...prev, [mode]: next };
        saveDensity(updated);
        return updated;
      });
      const dark = resolveDark(displayTheme);
      if ((mode === "dark") === dark) {
        applyAll({
          theme: displayTheme,
          look: resolveLook(activeLook),
          accentOverride,
          defaultAccent,
          density: next ?? defDensity(dark),
        });
      }
    },
    [displayTheme, resolveLook, activeLook, accentOverride, defaultAccent, defDensity, applyAll]
  );

  // Set (or clear) one mode's scene effects, like setTune.
  const setSceneFx = useCallback(
    (next: SceneFx | null, mode: Mode) => {
      setSceneFxs((prev) => {
        const updated = { ...prev, [mode]: next };
        saveSceneFx(updated);
        return updated;
      });
      const dark = resolveDark(displayTheme);
      if ((mode === "dark") === dark) {
        applyAll({
          theme: displayTheme,
          look: resolveLook(activeLook),
          accentOverride,
          defaultAccent,
          sceneFx: next ?? defSceneFx(dark),
        });
      }
    },
    [displayTheme, resolveLook, activeLook, accentOverride, defaultAccent, defSceneFx, applyAll]
  );

  // The Reduce motion switch: a preference, not a theme part, so it survives
  // "Reset theme" (the global reset clears it).
  const setReduceMotion = useCallback(
    (reduce: boolean) => {
      setReduceMotionState(reduce);
      saveReduceMotion(reduce);
      applyAll({
        theme: displayTheme,
        look: resolveLook(activeLook),
        accentOverride,
        defaultAccent,
        reduceMotion: reduce,
      });
    },
    [displayTheme, resolveLook, activeLook, accentOverride, defaultAccent, applyAll]
  );

  // Apply a curated pack to one mode: its design + scene + that mode's colorset,
  // and its tune over the design (a pack without one resets the tune, so the
  // curated look lands as designed). Font isn't part of a pack, so the mode's
  // font is left as-is.
  const applyPack = useCallback(
    (pack: ThemePack, mode: Mode) => {
      setDesign(pack.design, mode);
      setScene(pack.scene, mode);
      setTune(pack.tune ?? null, mode);
      setSceneFx(null, mode);
      // Fonts only when the pack carries them (#330); else the mode keeps its own.
      if (pack.font) setFont(pack.font, mode);
      if (pack.headingFont) setHeadingFont(pack.headingFont, mode);
      applyThemeColors({ dark: pack.dark, light: pack.light }, mode);
    },
    [setDesign, setScene, setTune, setSceneFx, setFont, setHeadingFont, applyThemeColors]
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
    [displayTheme, defaultAccent, accentOverride, activeLook, seedColorSet, applyAll]
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
    [accentOverride, displayTheme, defaultAccent, activeLook, resolveLook, applyAll]
  );

  const {
    customThemes,
    setCustomThemes,
    captureTheme,
    saveNamedTheme,
    applyNamedTheme,
    adoptTheme,
    renameNamedTheme,
    deleteNamedTheme,
    importNamedThemes,
  } = useSavedThemes({
    activeLook,
    seedColorSet,
    accentOverride,
    defaultAccent,
    resolveDesign,
    resolveScene,
    resolveFont,
    resolveTune,
    defTune,
    resolveSceneFx,
    defSceneFx,
    applyThemeColors,
    displayTheme,
    setDesigns,
    setScenes,
    setFonts,
    setTunes,
    setSceneFxs,
    reduceMotion,
    resolveHeading,
    resolveDensity,
    setHeadings,
    setDensities,
  });


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
  }, [defaultAccent, displayTheme, resolveLook, applyAll]);

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
    saveTune(null);
    saveSceneFx(null);
    saveHeadingFont(null);
    saveDensity(null);
    setDesigns({ dark: null, light: null });
    setScenes({ dark: null, light: null });
    setFonts({ dark: null, light: null });
    setTunes({ dark: null, light: null });
    setSceneFxs({ dark: null, light: null });
    setHeadings({ dark: null, light: null });
    setDensities({ dark: null, light: null });
    const dark = resolveDark(displayTheme);
    applyAll({
      theme: displayTheme,
      look: resolveLook(null),
      accentOverride: NO_ACCENT_OVERRIDES,
      defaultAccent,
      tune: defTune(dark),
      sceneFx: defSceneFx(dark),
      density: defDensity(dark),
    });
    applyDesign(defDesign(dark));
    applyScene(defScene(dark));
    applyFont(defFont(dark));
    applyHeadingFont(defHeading(dark));
  }, [
    defaultAccent,
    displayTheme,
    resolveLook,
    defDesign,
    defScene,
    defFont,
    defTune,
    defSceneFx,
    defDensity,
    defHeading,
    applyAll,
  ]);

  const resetLook = useCallback(() => {
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
    saveTune(null);
    saveSceneFx(null);
    saveReduceMotion(false);
    saveHeadingFont(null);
    saveDensity(null);
    setActiveLook(null);
    setAccentOverrideState(NO_ACCENT_OVERRIDES);
    setThemeState(defaultTheme.mode);
    setDesigns({ dark: null, light: null });
    setScenes({ dark: null, light: null });
    setFonts({ dark: null, light: null });
    setTunes({ dark: null, light: null });
    setSceneFxs({ dark: null, light: null });
    setReduceMotionState(false);
    setHeadings({ dark: null, light: null });
    setDensities({ dark: null, light: null });
    const dark = resolveDark(defaultTheme.mode);
    paintAll({
      theme: defaultTheme.mode,
      look: adminLook,
      accentOverride: NO_ACCENT_OVERRIDES,
      defaultAccent,
      tune: defTune(dark),
      sceneFx: defSceneFx(dark),
      reduceMotion: false,
      density: defDensity(dark),
    });
    applyDesign(defDesign(dark));
    applyScene(defScene(dark));
    applyFont(defFont(dark));
    applyHeadingFont(defHeading(dark));
  }, [
    defaultTheme.mode,
    defDesign,
    defScene,
    defFont,
    defTune,
    defSceneFx,
    defDensity,
    defHeading,
    adminLook,
    defaultAccent,
  ]);

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
    const storedTunes = loadTune();
    const storedFx = loadSceneFx();
    const storedReduce = loadReduceMotion();
    const storedHeadings = loadHeadingFont();
    const storedDensities = loadDensity();
    const headingOf = (dark: boolean): FontId | null => {
      const v = dark ? storedHeadings.dark : storedHeadings.light;
      if (v === "body") return null;
      return v ?? defHeading(dark);
    };
    // Resolve a mode's design/scene/font/tune/effects from the loaded pairs +
    // admin defaults (the state isn't committed yet, so resolve from the raw
    // values).
    const chromeFor = (dark: boolean) => ({
      design: (dark ? storedDesigns.dark : storedDesigns.light) ?? defDesign(dark),
      scene: (dark ? storedScenes.dark : storedScenes.light) ?? defScene(dark),
      font: (dark ? storedFonts.dark : storedFonts.light) ?? defFont(dark),
      tune: (dark ? storedTunes.dark : storedTunes.light) ?? defTune(dark),
      sceneFx: (dark ? storedFx.dark : storedFx.light) ?? defSceneFx(dark),
      heading: headingOf(dark),
      density: (dark ? storedDensities.dark : storedDensities.light) ?? defDensity(dark),
    });
    /* eslint-disable react-hooks/set-state-in-effect */
    setThemeState(stored);
    setDesigns(storedDesigns);
    setScenes(storedScenes);
    setFonts(storedFonts);
    setTunes(storedTunes);
    setSceneFxs(storedFx);
    setReduceMotionState(storedReduce);
    setHeadings(storedHeadings);
    setDensities(storedDensities);
    setActiveLook(active);
    setAccentOverrideState(overrideAccent);
    setCustomThemes(loadThemes());
    setSystemDark(
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // The inline script already applied these; re-apply for consistency.
    const initial = chromeFor(resolveDark(stored));
    paintAll({
      theme: stored,
      look: resolveLook(active),
      accentOverride: overrideAccent,
      defaultAccent,
      tune: initial.tune,
      sceneFx: initial.sceneFx,
      reduceMotion: storedReduce,
      density: initial.density,
    });
    applyDesign(initial.design);
    applyScene(initial.scene);
    applyFont(initial.font);
    applyHeadingFont(initial.heading);

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
      const next = chromeFor(mq.matches);
      paintAll({
        theme: "system",
        look,
        accentOverride: loadAccentOverride(),
        defaultAccent,
        tune: next.tune,
        sceneFx: next.sceneFx,
        reduceMotion: loadReduceMotion(),
        density: next.density,
      });
      applyDesign(next.design);
      applyScene(next.scene);
      applyFont(next.font);
      applyHeadingFont(next.heading);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
    // Mount-only: the admin default theme is stable server-provided data;
    // re-running this on a new prop identity would clobber live theme state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const look = useMemo<LookValue>(() => {
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
    return {
      theme,
      resolvedMode: displayDark ? "dark" : "light",
      design: resolveDesign(displayDark),
      scene: resolveScene(displayDark),
      font: resolveFont(displayDark),
      designFor: (mode: Mode) => resolveDesign(mode === "dark"),
      sceneFor: (mode: Mode) => resolveScene(mode === "dark"),
      fontFor: (mode: Mode) => resolveFont(mode === "dark"),
      tuneFor: (mode: Mode) => resolveTune(mode === "dark"),
      sceneFxFor: (mode: Mode) => resolveSceneFx(mode === "dark"),
      headingFontFor: (mode: Mode) => resolveHeading(mode === "dark"),
      densityFor: (mode: Mode) => resolveDensity(mode === "dark"),
      colorsFor: (mode: Mode) => {
        const dark = mode === "dark";
        const cs = variantFor(effectiveLook, dark) ?? seedColorSet(dark);
        const a = resolveAccent(overrideFor(accentOverride, dark), cs, defaultAccent);
        return { ...cs, accentFrom: a.from, accentTo: a.to };
      },
      reduceMotion,
      motion: reduceMotion ? "off" : (resolveSceneFx(displayDark)?.motion ?? "normal"),
      hydrated,
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
      setTheme,
      setPreviewMode,
      setDesign,
      setScene,
      setFont,
      setTune,
      setSceneFx,
      setReduceMotion,
      setHeadingFont,
      setDensity,
      applyPack,
      applyThemeColors,
      setBaseColors,
      setAccentOverride,
      saveNamedTheme,
      applyNamedTheme,
      captureTheme,
      adoptTheme,
      renameNamedTheme,
      deleteNamedTheme,
      importNamedThemes,
      clearCustomTheme,
      resetTheme,
    };
  }, [
    defaultAccent,
    adminLook,
    theme,
    displayTheme,
    resolveDesign,
    resolveScene,
    resolveFont,
    resolveTune,
    resolveSceneFx,
    reduceMotion,
    resolveHeading,
    resolveDensity,
    hydrated,
    seedColorSet,
    systemDark,
    customThemes,
    activeLook,
    accentOverride,
    setTheme,
    setPreviewMode,
    setDesign,
    setScene,
    setFont,
    setTune,
    setSceneFx,
    setReduceMotion,
    setHeadingFont,
    setDensity,
    applyPack,
    applyThemeColors,
    setBaseColors,
    setAccentOverride,
    saveNamedTheme,
    applyNamedTheme,
    captureTheme,
    adoptTheme,
    renameNamedTheme,
    deleteNamedTheme,
    importNamedThemes,
    clearCustomTheme,
    resetTheme,
  ]);

  return { look, resetLook };
}
