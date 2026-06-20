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
  type Units,
  type VisitorLocation,
  type VisitorPrefs,
  type ThemeColors,
  type CustomTheme,
} from "@/lib/prefs";

export type Theme = "system" | "light" | "dark";
export const THEME_KEY = "homepage:theme";

type Accent = { from: string; to: string };

// Apply the theme by toggling `.theme-light` on <html>. Kept in sync with the
// no-flash inline script in app/layout.tsx (which runs this same logic before
// React mounts).
function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("theme-light", !dark);
}

// A custom theme sets every color variable directly (so light/dark mode no
// longer applies); `--fg` reuses the foreground "ink" color.
function applyColors(colors: ThemeColors): void {
  if (typeof document === "undefined") return;
  const s = document.documentElement.style;
  s.setProperty("--background", colors.background);
  s.setProperty("--foreground", colors.foreground);
  s.setProperty("--fg", colors.foreground);
  s.setProperty("--accent-from", colors.accentFrom);
  s.setProperty("--accent-to", colors.accentTo);
  document.documentElement.classList.remove("theme-light");
}

// Drop the custom color overrides and fall back to the mode (light/dark),
// restoring the admin-configured accent.
function clearColors(accent: Accent, theme: Theme): void {
  if (typeof document === "undefined") return;
  const s = document.documentElement.style;
  s.removeProperty("--background");
  s.removeProperty("--foreground");
  s.removeProperty("--fg");
  s.setProperty("--accent-from", accent.from);
  s.setProperty("--accent-to", accent.to);
  applyTheme(theme);
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
  theme: Theme;
  customThemes: CustomTheme[];
  activeColors: ThemeColors | null;
  setTimezone: (tz: string) => void;
  setUnits: (units: Units) => void;
  useMyLocation: () => void;
  setTheme: (theme: Theme) => void;
  setCustomColors: (colors: ThemeColors) => void;
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

export function PrefsProvider({
  defaults,
  weatherEnabled,
  accent,
  children,
}: {
  defaults: Defaults;
  weatherEnabled: boolean;
  accent: Accent;
  children: ReactNode;
}) {
  // Start empty so the first client render matches the server (which only knows
  // the admin defaults); detection/overrides are applied after mount.
  const [prefs, setPrefs] = useState<VisitorPrefs>({});
  const [detectedTz, setDetectedTz] = useState<string | undefined>();
  const [detecting, setDetecting] = useState(false);
  const [theme, setThemeState] = useState<Theme>("system");
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [activeColors, setActiveColors] = useState<ThemeColors | null>(null);

  const persist = useCallback((next: VisitorPrefs) => {
    setPrefs(next);
    savePrefs(next);
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        // Private mode / quota — theme just won't persist.
      }
      // Selecting a mode exits any custom theme.
      setActiveColors(null);
      saveActiveTheme(null);
      clearColors(accent, next);
    },
    [accent]
  );

  // Apply (and persist as active) a set of custom colors — the live preview as
  // you edit in the theme builder.
  const setCustomColors = useCallback((colors: ThemeColors) => {
    applyColors(colors);
    setActiveColors(colors);
    saveActiveTheme(colors);
  }, []);

  const saveNamedTheme = useCallback((name: string, colors: ThemeColors) => {
    const entry: CustomTheme = {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, 40) || "Custom",
      ...colors,
    };
    setCustomThemes((prev) => {
      const next = [...prev, entry];
      saveThemes(next);
      return next;
    });
  }, []);

  const applyNamedTheme = useCallback(
    (id: string) => {
      const t = customThemes.find((x) => x.id === id);
      if (!t) return;
      setCustomColors({
        background: t.background,
        foreground: t.foreground,
        accentFrom: t.accentFrom,
        accentTo: t.accentTo,
      });
    },
    [customThemes, setCustomColors]
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
    clearColors(accent, theme);
  }, [accent, theme]);

  // Load the stored theme + custom themes on mount and keep "system" in sync
  // with OS changes.
  useEffect(() => {
    let stored: Theme = "system";
    try {
      const raw = window.localStorage.getItem(THEME_KEY);
      if (raw === "light" || raw === "dark" || raw === "system") stored = raw;
    } catch {
      // ignore
    }
    const active = loadActiveTheme();
    /* eslint-disable react-hooks/set-state-in-effect */
    setThemeState(stored);
    setActiveColors(active);
    setCustomThemes(loadThemes());
    /* eslint-enable react-hooks/set-state-in-effect */
    // The inline script already applied this; re-apply for consistency.
    if (active) applyColors(active);
    else applyTheme(stored);

    // Re-apply on OS scheme change (only "system" mode tracks it; a custom
    // theme defines its own colors and ignores the OS).
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (loadActiveTheme()) return;
      let t: Theme = "system";
      try {
        const raw = window.localStorage.getItem(THEME_KEY);
        if (raw === "light" || raw === "dark" || raw === "system") t = raw;
      } catch {
        // ignore
      }
      applyTheme(t);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
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

  const reset = useCallback(() => {
    // Clear overrides and remember the reset so auto IP-detection won't re-run.
    persist({ dismissedAuto: true });
  }, [persist]);

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
      theme,
      customThemes,
      activeColors,
      setTimezone,
      setUnits,
      useMyLocation,
      setTheme,
      setCustomColors,
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
    theme,
    customThemes,
    activeColors,
    setTimezone,
    setUnits,
    useMyLocation,
    setTheme,
    setCustomColors,
    saveNamedTheme,
    applyNamedTheme,
    deleteNamedTheme,
    clearCustomTheme,
    reset,
  ]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}
