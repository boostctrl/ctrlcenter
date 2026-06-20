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
  setTimezone: (tz: string) => void;
  setUnits: (units: Units) => void;
  useMyLocation: () => void;
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

  const persist = useCallback((next: VisitorPrefs) => {
    setPrefs(next);
    savePrefs(next);
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
      setTimezone,
      setUnits,
      useMyLocation,
      reset,
    };
  }, [prefs, detectedTz, defaults, detecting, weatherEnabled, setTimezone, setUnits, useMyLocation, reset]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}
