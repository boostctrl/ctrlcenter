"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Context,
  type ReactNode,
} from "react";
import {
  detectTimezone,
  loadPrefs,
  savePrefs,
  loadFavorites,
  saveFavorites,
  type Units,
  type VisitorPrefs,
} from "@/lib/prefs";
import type { Mode, Theme } from "./prefs/themeApply";
import { useLocationDetect } from "./prefs/useLocationDetect";
import { useLook, type DefaultTheme, type LookValue } from "./prefs/useLook";

// Per-visitor preferences, client-only (localStorage), in three contexts so a
// change re-renders only what reads it (#290): the locale (time zone, units,
// weather location, greeting name), the look (./prefs/useLook — mode,
// design/scene/font, colors, saved themes) and favorites. An app icon reads
// only the look's surface lightness; it no longer re-renders when a pin or
// the location changes. Read through useLocalePrefs, useLookPrefs and
// useFavorites; useVisitorPrefs merges all three (plus the global reset) for
// the settings surfaces that use most of it.
export type { Theme, Mode, DefaultTheme, LookValue };
export { THEME_KEY } from "./prefs/useLook";

type EffectiveLocation = {
  latitude: number;
  longitude: number;
  label?: string;
  isDefault: boolean;
};

export type LocaleValue = {
  timezone: string;
  units: Units;
  location: EffectiveLocation;
  detecting: boolean;
  locationError: string | null;
  weatherEnabled: boolean;
  greetingName: string;
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
};

export type FavoritesValue = {
  // Per-visitor pinned app IDs (pin order) and a toggle. Surfaced as a Favorites
  // row on the dashboard; client-only.
  favorites: string[];
  toggleFavorite: (id: string) => void;
};

export type PrefsValue = LocaleValue &
  LookValue &
  FavoritesValue & {
    // Back to the site defaults: locale overrides and the whole look.
    reset: () => void;
  };

const LocaleContext = createContext<LocaleValue | null>(null);
const LookContext = createContext<(LookValue & { reset: () => void }) | null>(null);
const FavoritesContext = createContext<FavoritesValue | null>(null);

function useRequired<T>(ctx: Context<T | null>, name: string): T {
  const value = useContext(ctx);
  if (!value) throw new Error(`${name} must be used within PrefsProvider`);
  return value;
}

export const useLocalePrefs = (): LocaleValue => useRequired(LocaleContext, "useLocalePrefs");
export const useLookPrefs = (): LookValue & { reset: () => void } =>
  useRequired(LookContext, "useLookPrefs");
export const useFavorites = (): FavoritesValue => useRequired(FavoritesContext, "useFavorites");

// Everything at once — subscribes to all three contexts, so prefer the
// narrow hooks above outside the settings surfaces.
export function useVisitorPrefs(): PrefsValue {
  const locale = useLocalePrefs();
  const look = useLookPrefs();
  const favorites = useFavorites();
  return useMemo(() => ({ ...locale, ...look, ...favorites }), [locale, look, favorites]);
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
  defaultTheme,
  children,
}: {
  defaults: Defaults;
  weatherEnabled: boolean;
  defaultTheme: DefaultTheme;
  children: ReactNode;
}) {
  // Start empty so the first client render matches the server (which only knows
  // the admin defaults); detection/overrides are applied after mount.
  const [prefs, setPrefs] = useState<VisitorPrefs>({});
  const [detectedTz, setDetectedTz] = useState<string | undefined>();
  // Pinned app IDs (starts empty to match SSR; hydrated from localStorage on mount).
  const [favorites, setFavorites] = useState<string[]>([]);
  const { look, resetLook } = useLook(defaultTheme);

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
    // Clear overrides and remember the reset so auto IP-detection won't re-run,
    // then drop all theme customizations so the visitor falls back to the
    // admin default theme (mode, design, colors, accent).
    persist({ dismissedAuto: true });
    resetLook();
  }, [persist, resetLook]);

  const locale = useMemo<LocaleValue>(() => {
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
      timezone: prefs.timezone || detectedTz || defaults.timezone,
      units: prefs.units || defaults.units,
      location,
      detecting,
      locationError,
      weatherEnabled,
      greetingName: prefs.greetingName ?? "",
      setTimezone,
      setUnits,
      setGreetingName,
      useMyLocation,
      setManualLocation,
      clearLocation,
    };
  }, [
    prefs,
    detectedTz,
    defaults,
    detecting,
    locationError,
    weatherEnabled,
    setTimezone,
    setUnits,
    setGreetingName,
    useMyLocation,
    setManualLocation,
    clearLocation,
  ]);

  const lookValue = useMemo(() => ({ ...look, reset }), [look, reset]);
  const favoritesValue = useMemo<FavoritesValue>(
    () => ({ favorites, toggleFavorite }),
    [favorites, toggleFavorite]
  );

  return (
    <LocaleContext.Provider value={locale}>
      <LookContext.Provider value={lookValue}>
        <FavoritesContext.Provider value={favoritesValue}>{children}</FavoritesContext.Provider>
      </LookContext.Provider>
    </LocaleContext.Provider>
  );
}
