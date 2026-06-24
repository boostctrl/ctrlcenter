"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useVisitorPrefs } from "./PrefsProvider";
import { supportedTimezones } from "@/lib/prefs";

// The per-visitor preference controls (greeting name, time zone, weather
// location/units, reset) plus the admin link. Theme/design live in the theme
// builder. Rendered on the /settings page; reads/writes the shared PrefsProvider.
export default function SettingsControls() {
  const {
    theme,
    setTheme,
    timezone,
    units,
    location,
    detecting,
    locationError,
    weatherEnabled,
    greetingName,
    setTimezone,
    setUnits,
    setGreetingName,
    useMyLocation,
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
      <div>
        <h2 className="font-semibold">Preferences</h2>
        <p className="text-xs text-fg/50">
          Personalize your view — saved in this browser only.
        </p>
      </div>

      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="text-fg/50">Appearance mode</span>
          <div className="flex w-fit overflow-hidden rounded-lg border border-fg/10">
            {(["system", "light", "dark"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setTheme(m)}
                className={`px-4 py-2 text-xs capitalize transition-colors ${
                  theme === m
                    ? "bg-fg/15 text-fg"
                    : "text-fg/50 hover:text-fg/80"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="text-xs text-fg/40">
            Light, dark, or follow your device.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="greeting-name" className="text-fg/50">
            Greeting name
          </label>
          <input
            id="greeting-name"
            value={greetingName}
            onChange={(e) => setGreetingName(e.target.value)}
            placeholder="e.g. Elliott"
            maxLength={60}
            className="accent-focus w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-fg outline-none transition-colors"
          />
          <p className="text-xs text-fg/40">
            Shown as “Good evening, {greetingName || "…"}!”
          </p>
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
              <span className="text-fg/50">Weather location</span>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-fg/10 bg-fg/5 px-3 py-2">
                <span className="truncate text-fg/70">{locationText}</span>
                <button
                  type="button"
                  onClick={useMyLocation}
                  disabled={detecting}
                  className="shrink-0 rounded-md border border-fg/10 bg-fg/5 px-2.5 py-1 text-xs text-fg/80 transition-colors hover:bg-fg/10 disabled:opacity-50"
                >
                  {detecting ? "Locating…" : "Use my location"}
                </button>
              </div>
              {locationError && (
                <p className="text-xs text-red-400">{locationError}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <span className="text-fg/50">Units</span>
              <div className="flex w-fit overflow-hidden rounded-lg border border-fg/10">
                {(["imperial", "metric"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUnits(u)}
                    className={`px-4 py-2 text-xs transition-colors ${
                      units === u
                        ? "bg-fg/15 text-fg"
                        : "text-fg/50 hover:text-fg/80"
                    }`}
                  >
                    {u === "imperial" ? "°F" : "°C"}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-fg/10 pt-4">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
        >
          Reset all settings
        </button>
        <Link
          href="/admin"
          className="text-sm text-fg/60 transition-colors hover:text-fg"
        >
          Admin portal <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}
