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
  type VisitorPrefs,
  NO_ACCENT_OVERRIDES,
  type CustomTheme,
  type AccentColors,
  type AccentOverrides,
  type ModePair,
} from "@/lib/prefs";
import type {
  ColorSet,
  DesignId,
  ModeColors,
  SceneId,
  ThemePack,
} from "@/lib/theme";
import type { FontId } from "@/lib/fonts";
import {
  applyAll,
  applyDesign,
  applyFont,
  applyScene,
  isLightColor,
  overrideFor,
  resolveAccent,
  resolveDark,
  variantFor,
  type Accent,
  type Mode,
  type Theme,
} from "./prefs/themeApply";
import { useLocationDetect } from "./prefs/useLocationDetect";
import { useSavedThemes } from "./prefs/useSavedThemes";

// The theme helpers (DOM application, luminance, accent resolution) live in
// ./prefs/themeApply, location detection in ./prefs/useLocationDetect and the
// saved-theme CRUD in ./prefs/useSavedThemes; this provider owns the state and
// assembles the one context every consumer reads through useVisitorPrefs.
export type { Theme, Mode };
export const THEME_KEY = "ctrlcenter:theme";

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
  // Set the weather location by hand (city search) — the path that works on
  // plain-HTTP deployments where device geolocation is unavailable (#122).
  setManualLocation: (latitude: number, longitude: number, label?: string) => void;
  // Return to the site default location (also stops the IP auto-detection from
  // re-overriding the choice on the next visit).
  clearLocation: () => void;
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
  // Returns false when the theme couldn't be persisted (storage unavailable).
  // With `overwriteId`, replaces that saved theme in place (same id and list
  // position) instead of appending a second copy.
  saveNamedTheme: (name: string, overwriteId?: string) => boolean;
  applyNamedTheme: (id: string) => void;
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
  accentFromLight?: string;
  accentToLight?: string;
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
  // Start empty so the first client render matches the server (which only knows
  // the admin defaults); detection/overrides are applied after mount.
  const [prefs, setPrefs] = useState<VisitorPrefs>({});
  const [detectedTz, setDetectedTz] = useState<string | undefined>();
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

  const {
    detecting,
    locationError,
    detectFromIp,
    setManualLocation,
    clearLocation,
    useMyLocation,
  } = useLocationDetect({ prefs, persist, weatherEnabled });


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

  const {
    customThemes,
    setCustomThemes,
    saveNamedTheme,
    applyNamedTheme,
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
    applyThemeColors,
    displayTheme,
    setDesigns,
    setScenes,
    setFonts,
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

    return detectFromIp(stored);
  }, [detectFromIp]);

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
      setManualLocation,
      clearLocation,
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
      renameNamedTheme,
      deleteNamedTheme,
      importNamedThemes,
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
    setManualLocation,
    clearLocation,
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
    renameNamedTheme,
    deleteNamedTheme,
    importNamedThemes,
    clearCustomTheme,
    resetTheme,
    reset,
  ]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}
