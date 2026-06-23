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
  type Units,
  type VisitorLocation,
  type VisitorPrefs,
  type CustomTheme,
  type AccentColors,
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

export type Theme = "system" | "light" | "dark";
export const THEME_KEY = "ctrlcenter:theme";

type Accent = AccentColors;

// Resolve whether the given mode renders dark right now ("system" follows the
// OS). Kept in sync with the no-flash inline script in app/layout.tsx.
function resolveDark(theme: Theme): boolean {
  if (typeof window === "undefined") return true;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return theme === "dark" || (theme === "system" && prefersDark);
}

function applyAccent(accent: Accent): void {
  if (typeof document === "undefined") return;
  const s = document.documentElement.style;
  s.setProperty("--accent-from", accent.from);
  s.setProperty("--accent-to", accent.to);
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

// Perceived luminance of a #rrggbb color — used to decide whether the current
// surface reads as light (so themed icons can pick a legible variant).
function isLightColor(hex: string): boolean {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
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
  accentOverride: AccentColors | null;
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
  applyAccent(resolveAccent(opts.accentOverride, cs, opts.defaultAccent));
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
  design: DesignId;
  scene: SceneId;
  // Whether the effective background reads as light (for theme-aware icons).
  surfaceIsLight: boolean;
  customThemes: CustomTheme[];
  // The active look's full light+dark pair, and the color set resolved for the
  // current mode (what the builder's pickers show).
  activeLook: ModeColors | null;
  activeColors: ColorSet | null;
  accentOverride: AccentColors | null;
  activeAccent: AccentColors;
  setTimezone: (tz: string) => void;
  setUnits: (units: Units) => void;
  setGreetingName: (name: string) => void;
  useMyLocation: () => void;
  setTheme: (theme: Theme) => void;
  setDesign: (design: DesignId) => void;
  setScene: (scene: SceneId) => void;
  applyPack: (pack: ThemePack) => void;
  applyThemeColors: (colors: ModeColors) => void;
  setBaseColors: (background: string, foreground: string) => void;
  setAccentOverride: (accent: AccentColors | null) => void;
  saveNamedTheme: (name: string, colors: ModeColors) => void;
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
  design: DesignId;
  scene: SceneId;
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
  const [design, setDesignState] = useState<DesignId>(defaultTheme.design);
  const [scene, setSceneState] = useState<SceneId>(defaultTheme.scene);
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [activeLook, setActiveLook] = useState<ModeColors | null>(null);
  const [accentOverride, setAccentOverrideState] =
    useState<AccentColors | null>(null);
  // Whether the visitor has explicitly picked a light/dark mode. Until they do,
  // the admin custom default colors (if any) are the baseline.
  const [modeChosen, setModeChosen] = useState(false);
  // Tracks the OS color scheme so "system" mode resolves its surface lightness.
  const [systemDark, setSystemDark] = useState(false);

  // The look to apply: a per-visitor custom look wins, then the admin custom
  // default colors (only while the visitor hasn't picked a mode), otherwise null
  // = follow the built-in light/dark CSS defaults.
  const resolveLook = useCallback(
    (active: ModeColors | null, chosen: boolean): ModeColors | null =>
      active ?? (chosen ? null : adminLook),
    [adminLook]
  );

  const persist = useCallback((next: VisitorPrefs) => {
    setPrefs(next);
    savePrefs(next);
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      setModeChosen(true);
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        // Private mode / quota — theme just won't persist.
      }
      // Picking a mode keeps the active look; it just re-resolves to that look's
      // matching light/dark variant (the admin default colors stop applying once
      // a mode is chosen, so resolve against the visitor look only).
      applyAll({ theme: next, look: activeLook, accentOverride, defaultAccent });
    },
    [activeLook, accentOverride, defaultAccent]
  );

  const setDesign = useCallback((next: DesignId) => {
    setDesignState(next);
    saveDesign(next);
    applyDesign(next);
  }, []);

  const setScene = useCallback((next: SceneId) => {
    setSceneState(next);
    saveScene(next);
    applyScene(next);
  }, []);

  // Apply (and persist) a full custom look — base presets and saved themes. The
  // look carries its own accent, so any standalone accent override is dropped in
  // favor of it. The resolved mode picks which variant is applied.
  const applyThemeColors = useCallback(
    (look: ModeColors) => {
      setActiveLook(look);
      saveActiveTheme(look);
      setAccentOverrideState(null);
      saveAccentOverride(null);
      applyAll({ theme, look, accentOverride: null, defaultAccent });
    },
    [theme, defaultAccent]
  );

  // Apply a curated pack in one tap: its design + scene + light/dark color pair.
  const applyPack = useCallback(
    (pack: ThemePack) => {
      setDesign(pack.design);
      setScene(pack.scene);
      applyThemeColors({ dark: pack.dark, light: pack.light });
    },
    [setDesign, setScene, applyThemeColors]
  );

  // Update only the background/foreground for the CURRENT mode's variant,
  // leaving the accent and the other mode's variant as-is (live edit from the
  // theme builder's base-color pickers). With no active look yet, seed both
  // modes from the edit so the new look still has both.
  const setBaseColors = useCallback(
    (background: string, foreground: string) => {
      const dark = resolveDark(theme);
      const accent = resolveAccent(
        accentOverride,
        variantFor(activeLook, dark),
        defaultAccent
      );
      const cs: ColorSet = {
        background,
        foreground,
        accentFrom: accent.from,
        accentTo: accent.to,
      };
      const base = activeLook ?? { dark: cs, light: cs };
      const next: ModeColors = dark ? { ...base, dark: cs } : { ...base, light: cs };
      setActiveLook(next);
      saveActiveTheme(next);
      applyAll({ theme, look: next, accentOverride, defaultAccent });
    },
    [theme, defaultAccent, accentOverride, activeLook]
  );

  // Set or clear the accent on its own, leaving the background/foreground as-is.
  const setAccentOverride = useCallback(
    (next: AccentColors | null) => {
      setAccentOverrideState(next);
      saveAccentOverride(next);
      applyAll({
        theme,
        look: resolveLook(activeLook, modeChosen),
        accentOverride: next,
        defaultAccent,
      });
    },
    [theme, defaultAccent, activeLook, modeChosen, resolveLook]
  );

  const saveNamedTheme = useCallback(
    (name: string, colors: ModeColors) => {
      const entry: CustomTheme = {
        id: crypto.randomUUID(),
        name: name.trim().slice(0, 40) || "Custom",
        design,
        scene,
        ...colors,
      };
      setCustomThemes((prev) => {
        const next = [...prev, entry];
        saveThemes(next);
        return next;
      });
    },
    [design, scene]
  );

  const applyNamedTheme = useCallback(
    (id: string) => {
      const t = customThemes.find((x) => x.id === id);
      if (!t) return;
      setDesign(t.design);
      setScene(t.scene);
      applyThemeColors({ dark: t.dark, light: t.light });
    },
    [customThemes, applyThemeColors, setDesign, setScene]
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
    setAccentOverrideState(null);
    saveAccentOverride(null);
    applyAll({
      theme,
      look: resolveLook(null, modeChosen),
      accentOverride: null,
      defaultAccent,
    });
  }, [defaultAccent, theme, modeChosen, resolveLook]);

  // Reset just the theme (colors, accent, design, scene) back to the admin
  // defaults, leaving mode/location/greeting alone — the theme-builder's own
  // reset, distinct from the global `reset`.
  const resetTheme = useCallback(() => {
    setActiveLook(null);
    saveActiveTheme(null);
    setAccentOverrideState(null);
    saveAccentOverride(null);
    saveDesign(null);
    saveScene(null);
    setDesignState(defaultTheme.design);
    setSceneState(defaultTheme.scene);
    applyAll({
      theme,
      look: resolveLook(null, modeChosen),
      accentOverride: null,
      defaultAccent,
    });
    applyDesign(defaultTheme.design);
    applyScene(defaultTheme.scene);
  }, [
    defaultAccent,
    theme,
    modeChosen,
    resolveLook,
    defaultTheme.design,
    defaultTheme.scene,
  ]);

  // Load the stored theme + custom themes on mount and keep "system" in sync
  // with OS changes. Anything the visitor hasn't set falls back to the admin
  // default theme.
  useEffect(() => {
    let stored: Theme = defaultTheme.mode;
    let chosen = false;
    try {
      const raw = window.localStorage.getItem(THEME_KEY);
      if (raw === "light" || raw === "dark" || raw === "system") {
        stored = raw;
        chosen = true;
      }
    } catch {
      // ignore
    }
    const active = loadActiveTheme();
    const overrideAccent = loadAccentOverride();
    const storedDesign = loadDesign() ?? defaultTheme.design;
    const storedScene = loadScene() ?? defaultTheme.scene;
    /* eslint-disable react-hooks/set-state-in-effect */
    setThemeState(stored);
    setModeChosen(chosen);
    setDesignState(storedDesign);
    setSceneState(storedScene);
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
      look: resolveLook(active, chosen),
      accentOverride: overrideAccent,
      defaultAccent,
    });
    applyDesign(storedDesign);
    applyScene(storedScene);

    // Re-apply on OS scheme change. Only "system" mode tracks the OS — but a look
    // is now mode-aware, so "system" must re-resolve the look's variant too.
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
      const look = resolveLook(loadActiveTheme(), isMode);
      applyAll({
        theme: "system",
        look,
        accentOverride: loadAccentOverride(),
        defaultAccent,
      });
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
    setActiveLook(null);
    setAccentOverrideState(null);
    setModeChosen(false);
    setThemeState(defaultTheme.mode);
    setDesignState(defaultTheme.design);
    setSceneState(defaultTheme.scene);
    applyAll({
      theme: defaultTheme.mode,
      look: adminLook,
      accentOverride: null,
      defaultAccent,
    });
    applyDesign(defaultTheme.design);
    applyScene(defaultTheme.scene);
  }, [
    persist,
    defaultTheme.mode,
    defaultTheme.design,
    defaultTheme.scene,
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
    // Resolve the current mode to a lightness, then pick the effective look's
    // matching variant (visitor look, else admin default colors). That variant's
    // background drives the surface-lightness used by theme-aware icons/scenes.
    const isLight = theme === "light" || (theme === "system" && !systemDark);
    const effectiveLook = activeLook ?? (modeChosen ? null : adminLook);
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
      design,
      scene,
      surfaceIsLight,
      customThemes,
      activeLook,
      activeColors,
      accentOverride,
      activeAccent: resolveAccent(accentOverride, activeColors, defaultAccent),
      setTimezone,
      setUnits,
      setGreetingName,
      useMyLocation,
      setTheme,
      setDesign,
      setScene,
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
    design,
    scene,
    systemDark,
    modeChosen,
    customThemes,
    activeLook,
    accentOverride,
    setTimezone,
    setUnits,
    setGreetingName,
    useMyLocation,
    setTheme,
    setDesign,
    setScene,
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
