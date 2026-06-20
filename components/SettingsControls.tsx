"use client";

import { useMemo } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import { supportedTimezones } from "@/lib/prefs";

// The per-visitor preference controls (theme, time zone, weather location/units,
// reset). Rendered on the /settings page; reads/writes the shared PrefsProvider.
export default function SettingsControls() {
  const {
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
  } = useVisitorPrefs();
  const zones = useMemo(() => supportedTimezones(), []);

  const locationText =
    location.label ??
    (location.isDefault
      ? "Site default"
      : `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`);

  return (
    <div className="space-y-6 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-fg/50">Theme</span>
        <div className="flex overflow-hidden rounded-lg border border-fg/10">
          {(["system", "light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className={`px-3 py-1.5 text-xs capitalize transition-colors ${
                theme === t ? "bg-fg/15 text-fg" : "text-fg/50 hover:text-fg/80"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="tz-input" className="text-fg/50">
          Time zone
        </label>
        <input
          id="tz-input"
          list="tz-options"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="accent-focus w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-fg outline-none transition-colors"
        />
        <datalist id="tz-options">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </div>

      {weatherEnabled && (
        <>
          <div className="space-y-1.5">
            <span className="text-fg/50">Location</span>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-fg/70">{locationText}</span>
              <button
                type="button"
                onClick={useMyLocation}
                disabled={detecting}
                className="shrink-0 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 text-xs text-fg/80 transition-colors hover:bg-fg/10 disabled:opacity-50"
              >
                {detecting ? "Locating…" : "Use my location"}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-fg/50">Units</span>
            <div className="flex overflow-hidden rounded-lg border border-fg/10">
              {(["imperial", "metric"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnits(u)}
                  className={`px-3 py-1.5 text-xs transition-colors ${
                    units === u ? "bg-fg/15 text-fg" : "text-fg/50 hover:text-fg/80"
                  }`}
                >
                  {u === "imperial" ? "°F" : "°C"}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={reset}
        className="text-xs text-fg/40 underline transition-colors hover:text-fg/70"
      >
        Reset to site default
      </button>
    </div>
  );
}
