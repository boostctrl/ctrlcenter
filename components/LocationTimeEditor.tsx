"use client";

import { useEffect, useMemo, useRef } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import { supportedTimezones } from "@/lib/prefs";

// Compact glass popover for correcting the auto-detected time zone and location.
// Opened by clicking the time/location line in the header.
export default function LocationTimeEditor({
  onClose,
}: {
  onClose: () => void;
}) {
  const {
    timezone,
    units,
    location,
    detecting,
    weatherEnabled,
    setTimezone,
    setUnits,
    useMyLocation,
    reset,
  } = useVisitorPrefs();
  const ref = useRef<HTMLDivElement>(null);
  const zones = useMemo(() => supportedTimezones(), []);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const locationText =
    location.label ??
    (location.isDefault
      ? "Site default"
      : `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Location and time settings"
      className="glass-card absolute top-full left-0 z-30 mt-3 w-72 space-y-4 p-4 text-sm"
    >
      <div className="space-y-1.5">
        <label htmlFor="tz-input" className="text-white/50">
          Time zone
        </label>
        <input
          id="tz-input"
          list="tz-options"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="accent-focus w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none transition-colors"
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
            <span className="text-white/50">Location</span>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-white/70">{locationText}</span>
              <button
                type="button"
                onClick={useMyLocation}
                disabled={detecting}
                className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                {detecting ? "Locating…" : "Use my location"}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-white/50">Units</span>
            <div className="flex overflow-hidden rounded-lg border border-white/10">
              {(["imperial", "metric"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnits(u)}
                  className={`px-3 py-1.5 text-xs transition-colors ${
                    units === u
                      ? "bg-white/15 text-white"
                      : "text-white/50 hover:text-white/80"
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
        onClick={() => {
          reset();
          onClose();
        }}
        className="text-xs text-white/40 underline transition-colors hover:text-white/70"
      >
        Reset to site default
      </button>
    </div>
  );
}
