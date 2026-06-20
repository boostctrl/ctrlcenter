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
  type Units,
  type VisitorLocation,
  type VisitorPrefs,
} from "@/lib/prefs";

export type Theme = "system" | "light" | "dark";
export const THEME_KEY = "homepage:theme";

// Apply the theme by toggling `.theme-light` on <html>. Kept in sync with the
// no-flash inline script in app/layout.tsx (which runs this same logic before
// React mounts).
function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("theme-light", !dark);
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
  setTimezone: (tz: string) => void;
  setUnits: (units: Units) => void;
  useMyLocation: () => void;
  setTheme: (theme: Theme) => void;
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
  children,
}: {
  defaults: Defaults;
  weatherEnabled: boolean;
  children: ReactNode;
}) {
  // Start empty so the first client render matches the server (which only knows
  // the admin defaults); detection/overrides are applied after mount.
  const [prefs, setPrefs] = useState<VisitorPrefs>({});
  const [detectedTz, setDetectedTz] = useState<string | undefined>();
  const [detecting, setDetecting] = useState(false);
  const [theme, setThemeState] = useState<Theme>("system");

  const persist = useCallback((next: VisitorPrefs) => {
    setPrefs(next);
    savePrefs(next);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode / quota — theme just won't persist.
    }
    applyTheme(next);
  }, []);

  // Load the stored theme on mount and keep "system" in sync with OS changes.
  useEffect(() => {
    let stored: Theme = "system";
    try {
      const raw = window.localStorage.getItem(THEME_KEY);
      if (raw === "light" || raw === "dark" || raw === "system") stored = raw;
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(stored);
    applyTheme(stored);

    // Re-apply on OS scheme change (only "system" actually tracks it).
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
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
      setTimezone,
      setUnits,
      useMyLocation,
      setTheme,
      reset,
    };
  }, [prefs, detectedTz, defaults, detecting, weatherEnabled, theme, setTimezone, setUnits, useMyLocation, setTheme, reset]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}
