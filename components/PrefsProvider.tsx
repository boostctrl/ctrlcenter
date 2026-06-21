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
  type Units,
  type VisitorLocation,
  type VisitorPrefs,
  type ThemeColors,
  type CustomTheme,
  type AccentColors,
} from "@/lib/prefs";
import { DESIGN_IDS, type DesignId } from "@/lib/theme";

export type Theme = "system" | "light" | "dark";
export const THEME_KEY = "homepage:theme";

type Accent = AccentColors;

// Apply the theme by toggling `.theme-light` on <html>. Kept in sync with the
// no-flash inline script in app/layout.tsx (which runs this same logic before
// React mounts).
function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("theme-light", !dark);
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

// Resolve the effective accent: an explicit per-visitor override wins, then a
// full custom theme's own accent, then the admin-configured default.
function resolveAccent(
  override: AccentColors | null,
  colors: ThemeColors | null,
  fallback: Accent
): Accent {
  if (override) return override;
  if (colors) return { from: colors.accentFrom, to: colors.accentTo };
  return fallback;
}

// Apply the whole theme state in one place. A full custom theme sets the
// background/foreground variables (light/dark mode no longer applies);
// otherwise we fall back to the mode. The accent is layered on top last, so an
// accent-only override leaves the background/foreground as-is.
function applyAll(opts: {
  theme: Theme;
  colors: ThemeColors | null;
  accentOverride: AccentColors | null;
  defaultAccent: Accent;
}): void {
  if (typeof document === "undefined") return;
  const s = document.documentElement.style;
  if (opts.colors) {
    s.setProperty("--background", opts.colors.background);
    s.setProperty("--foreground", opts.colors.foreground);
    s.setProperty("--fg", opts.colors.foreground);
    document.documentElement.classList.remove("theme-light");
  } else {
    s.removeProperty("--background");
    s.removeProperty("--foreground");
    s.removeProperty("--fg");
    applyTheme(opts.theme);
  }
  applyAccent(resolveAccent(opts.accentOverride, opts.colors, opts.defaultAccent));
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
  weatherEnabled: boolean;
  greetingName: string;
  theme: Theme;
  design: DesignId;
  customThemes: CustomTheme[];
  activeColors: ThemeColors | null;
  accentOverride: AccentColors | null;
  activeAccent: AccentColors;
  setTimezone: (tz: string) => void;
  setUnits: (units: Units) => void;
  setGreetingName: (name: string) => void;
  useMyLocation: () => void;
  setTheme: (theme: Theme) => void;
  setDesign: (design: DesignId) => void;
  applyThemeColors: (colors: ThemeColors) => void;
  setBaseColors: (background: string, foreground: string) => void;
  setAccentOverride: (accent: AccentColors | null) => void;
  saveNamedTheme: (name: string, colors: ThemeColors) => void;
  applyNamedTheme: (id: string) => void;
  deleteNamedTheme: (id: string) => void;
  clearCustomTheme: () => void;
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

// The admin-configured site default theme. Visitor choices override each part;
// `background`/`foreground` (when both set) are custom default colors that
// override the light/dark mode for un-customized visitors.
export type DefaultTheme = {
  mode: Theme;
  design: DesignId;
  accentFrom: string;
  accentTo: string;
  background?: string;
  foreground?: string;
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
  const adminColors: ThemeColors | null = useMemo(
    () =>
      defaultTheme.background && defaultTheme.foreground
        ? {
            background: defaultTheme.background,
            foreground: defaultTheme.foreground,
            accentFrom: defaultTheme.accentFrom,
            accentTo: defaultTheme.accentTo,
          }
        : null,
    [
      defaultTheme.background,
      defaultTheme.foreground,
      defaultTheme.accentFrom,
      defaultTheme.accentTo,
    ]
  );
  // Start empty so the first client render matches the server (which only knows
  // the admin defaults); detection/overrides are applied after mount.
  const [prefs, setPrefs] = useState<VisitorPrefs>({});
  const [detectedTz, setDetectedTz] = useState<string | undefined>();
  const [detecting, setDetecting] = useState(false);
  const [theme, setThemeState] = useState<Theme>(defaultTheme.mode);
  const [design, setDesignState] = useState<DesignId>(defaultTheme.design);
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [activeColors, setActiveColors] = useState<ThemeColors | null>(null);
  const [accentOverride, setAccentOverrideState] =
    useState<AccentColors | null>(null);
  // Whether the visitor has explicitly picked a light/dark mode. Until they do,
  // the admin custom default colors (if any) are the baseline.
  const [modeChosen, setModeChosen] = useState(false);

  // The background/foreground layer to apply: a per-visitor custom theme wins,
  // then the admin custom default colors (only while the visitor hasn't picked a
  // mode), otherwise null = follow the light/dark mode.
  const resolveBase = useCallback(
    (active: ThemeColors | null, chosen: boolean): ThemeColors | null =>
      active ?? (chosen ? null : adminColors),
    [adminColors]
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
      // Picking a mode exits any full custom theme (and the admin custom default
      // colors), but keeps the visitor's accent override.
      setActiveColors(null);
      saveActiveTheme(null);
      applyAll({ theme: next, colors: null, accentOverride, defaultAccent });
    },
    [accentOverride, defaultAccent]
  );

  const setDesign = useCallback((next: DesignId) => {
    setDesignState(next);
    saveDesign(next);
    applyDesign(next);
  }, []);

  // Apply (and persist) a full custom theme — base presets and saved themes.
  // The theme carries its own accent, so any standalone accent override is
  // dropped in favor of it.
  const applyThemeColors = useCallback(
    (colors: ThemeColors) => {
      setActiveColors(colors);
      saveActiveTheme(colors);
      setAccentOverrideState(null);
      saveAccentOverride(null);
      applyAll({ theme, colors, accentOverride: null, defaultAccent });
    },
    [theme, defaultAccent]
  );

  // Update only the background/foreground, leaving the accent as-is (live edit
  // from the theme builder's base-color pickers).
  const setBaseColors = useCallback(
    (background: string, foreground: string) => {
      const current = resolveAccent(accentOverride, activeColors, defaultAccent);
      const next: ThemeColors = {
        background,
        foreground,
        accentFrom: current.from,
        accentTo: current.to,
      };
      setActiveColors(next);
      saveActiveTheme(next);
      applyAll({ theme, colors: next, accentOverride, defaultAccent });
    },
    [theme, defaultAccent, accentOverride, activeColors]
  );

  // Set or clear the accent on its own, leaving the background/foreground as-is.
  const setAccentOverride = useCallback(
    (next: AccentColors | null) => {
      setAccentOverrideState(next);
      saveAccentOverride(next);
      applyAll({
        theme,
        colors: resolveBase(activeColors, modeChosen),
        accentOverride: next,
        defaultAccent,
      });
    },
    [theme, defaultAccent, activeColors, modeChosen, resolveBase]
  );

  const saveNamedTheme = useCallback(
    (name: string, colors: ThemeColors) => {
      const entry: CustomTheme = {
        id: crypto.randomUUID(),
        name: name.trim().slice(0, 40) || "Custom",
        design,
        ...colors,
      };
      setCustomThemes((prev) => {
        const next = [...prev, entry];
        saveThemes(next);
        return next;
      });
    },
    [design]
  );

  const applyNamedTheme = useCallback(
    (id: string) => {
      const t = customThemes.find((x) => x.id === id);
      if (!t) return;
      setDesign(t.design);
      applyThemeColors({
        background: t.background,
        foreground: t.foreground,
        accentFrom: t.accentFrom,
        accentTo: t.accentTo,
      });
    },
    [customThemes, applyThemeColors, setDesign]
  );

  const deleteNamedTheme = useCallback((id: string) => {
    setCustomThemes((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveThemes(next);
      return next;
    });
  }, []);

  const clearCustomTheme = useCallback(() => {
    setActiveColors(null);
    saveActiveTheme(null);
    setAccentOverrideState(null);
    saveAccentOverride(null);
    applyAll({
      theme,
      colors: resolveBase(null, modeChosen),
      accentOverride: null,
      defaultAccent,
    });
  }, [defaultAccent, theme, modeChosen, resolveBase]);

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
    /* eslint-disable react-hooks/set-state-in-effect */
    setThemeState(stored);
    setModeChosen(chosen);
    setDesignState(storedDesign);
    setActiveColors(active);
    setAccentOverrideState(overrideAccent);
    setCustomThemes(loadThemes());
    /* eslint-enable react-hooks/set-state-in-effect */
    // The inline script already applied these; re-apply for consistency.
    applyAll({
      theme: stored,
      colors: resolveBase(active, chosen),
      accentOverride: overrideAccent,
      defaultAccent,
    });
    applyDesign(storedDesign);

    // Re-apply on OS scheme change (only "system" mode tracks it; custom colors,
    // from the visitor or the admin default, define their own and ignore the OS).
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (loadActiveTheme()) return;
      let raw: string | null = null;
      try {
        raw = window.localStorage.getItem(THEME_KEY);
      } catch {
        // ignore
      }
      if (raw === "light" || raw === "dark" || raw === "system") {
        applyTheme(raw);
      } else if (!adminColors) {
        applyTheme(defaultTheme.mode);
      }
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
    setActiveColors(null);
    setAccentOverrideState(null);
    setModeChosen(false);
    setThemeState(defaultTheme.mode);
    setDesignState(defaultTheme.design);
    applyAll({
      theme: defaultTheme.mode,
      colors: adminColors,
      accentOverride: null,
      defaultAccent,
    });
    applyDesign(defaultTheme.design);
  }, [persist, defaultTheme.mode, defaultTheme.design, adminColors, defaultAccent]);

  const useMyLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
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
      () => setDetecting(false),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  }, [prefs, persist]);

  const value = useMemo<PrefsValue>(() => {
    const timezone = prefs.timezone || detectedTz || defaults.timezone;
    const units = prefs.units || defaults.units;
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
      weatherEnabled,
      greetingName: prefs.greetingName ?? "",
      theme,
      design,
      customThemes,
      activeColors,
      accentOverride,
      activeAccent: resolveAccent(accentOverride, activeColors, defaultAccent),
      setTimezone,
      setUnits,
      setGreetingName,
      useMyLocation,
      setTheme,
      setDesign,
      applyThemeColors,
      setBaseColors,
      setAccentOverride,
      saveNamedTheme,
      applyNamedTheme,
      deleteNamedTheme,
      clearCustomTheme,
      reset,
    };
  }, [
    prefs,
    detectedTz,
    defaults,
    detecting,
    weatherEnabled,
    defaultAccent,
    theme,
    design,
    customThemes,
    activeColors,
    accentOverride,
    setTimezone,
    setUnits,
    setGreetingName,
    useMyLocation,
    setTheme,
    setDesign,
    applyThemeColors,
    setBaseColors,
    setAccentOverride,
    saveNamedTheme,
    applyNamedTheme,
    deleteNamedTheme,
    clearCustomTheme,
    reset,
  ]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}
