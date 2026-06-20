"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useVisitorPrefs } from "./PrefsProvider";
import { supportedTimezones } from "@/lib/prefs";

// Per-visitor settings — everything a visitor can change without admin rights
// (theme, time zone, weather location/units), plus the link into the admin
// portal. Opened from a gear button in the header; preferences are stored in the
// browser and never touch the shared site config.
export default function UserSettings() {
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const zones = useMemo(() => supportedTimezones(), []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const locationText =
    location.label ??
    (location.isDefault
      ? "Site default"
      : `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Settings"
        title="Settings"
        className="flex h-10 w-10 items-center justify-center rounded-full border border-fg/10 bg-fg/5 text-fg/60 transition-colors hover:bg-fg/10 hover:text-fg"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="User settings"
          className="glass-card absolute right-0 z-40 mt-3 w-72 space-y-4 p-4 text-sm"
        >
          <h2 className="font-semibold">Settings</h2>

          <div className="flex items-center justify-between gap-2">
            <span className="text-fg/50">Theme</span>
            <div className="flex overflow-hidden rounded-lg border border-fg/10">
              {(["system", "light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  className={`px-2.5 py-1.5 text-xs capitalize transition-colors ${
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

          <div className="border-t border-fg/10 pt-3">
            <Link
              href="/admin"
              className="flex items-center justify-between text-fg/70 transition-colors hover:text-fg"
            >
              Admin portal
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
