"use client";

import { useCallback, useState } from "react";
import type { VisitorLocation, VisitorPrefs } from "@/lib/prefs";

// The visitor's weather location: first-visit IP detection (ipwho.is), device
// geolocation with a reverse-geocoded label (bigdatacloud), manual city
// search and "back to the site default". Writes through PrefsProvider's
// `persist`, so the location lives in the same stored prefs object as the
// rest of the visitor's choices.
export function useLocationDetect({
  prefs,
  persist,
  weatherEnabled,
}: {
  prefs: VisitorPrefs;
  persist: (next: VisitorPrefs) => void;
  weatherEnabled: boolean;
}) {
  const [detecting, setDetecting] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // IP-detect the location on a first visit (no stored location, not
  // previously reset). PrefsProvider calls this from its mount effect with the
  // prefs it just loaded and returns the cleanup, so a new identity (persist
  // or weatherEnabled changed) re-runs that effect exactly as before.
  const detectFromIp = useCallback(
    (stored: VisitorPrefs): (() => void) | undefined => {
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
    },
    [persist, weatherEnabled]
  );

  const setManualLocation = useCallback(
    (latitude: number, longitude: number, label?: string) => {
      setLocationError(null);
      persist({
        ...prefs,
        location: { latitude, longitude, label, source: "manual" },
      });
    },
    [prefs, persist]
  );

  const clearLocation = useCallback(() => {
    setLocationError(null);
    // dismissedAuto: an explicit "back to the site default" must stick — without
    // it the first-visit IP detection would re-fill the location on reload.
    persist({ ...prefs, location: undefined, dismissedAuto: true });
  }, [prefs, persist]);

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

  return {
    detecting,
    locationError,
    detectFromIp,
    setManualLocation,
    clearLocation,
    useMyLocation,
  };
}
