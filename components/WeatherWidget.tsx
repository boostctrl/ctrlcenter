"use client";

import { useEffect, useState } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import {
  fetchWeather,
  unitSymbol,
  weatherCodeToIcon,
  type CurrentWeather,
  type Units,
} from "@/lib/weather";

// Seeded with the server-rendered default-location weather (so there's no empty
// flash), then re-fetches client-side when the visitor's effective location or
// units differ from the admin default.
export default function WeatherWidget({
  initial,
  defaultLat,
  defaultLon,
  defaultUnits,
}: {
  initial: CurrentWeather | null;
  defaultLat: number;
  defaultLon: number;
  defaultUnits: Units;
}) {
  const { location, units } = useVisitorPrefs();
  const [fetched, setFetched] = useState<CurrentWeather | null>(null);

  // The default location/units are already rendered server-side as `initial`,
  // so only fetch when the effective values differ. Deriving this in render
  // (rather than syncing it into state) avoids a setState-in-effect.
  const usesDefault =
    Math.abs(location.latitude - defaultLat) < 1e-4 &&
    Math.abs(location.longitude - defaultLon) < 1e-4 &&
    units === defaultUnits;

  useEffect(() => {
    if (usesDefault) return;
    let active = true;
    fetchWeather(location.latitude, location.longitude, units).then((w) => {
      if (active) setFetched(w);
    });
    return () => {
      active = false;
    };
  }, [usesDefault, location.latitude, location.longitude, units]);

  // While an override is loading, keep showing the default rather than blanking.
  const weather = usesDefault ? initial : (fetched ?? initial);
  if (!weather) return null;

  return (
    <div className="glass-card flex items-center gap-4 px-6 py-4">
      <span className="text-4xl" aria-hidden>
        {weatherCodeToIcon(weather.code)}
      </span>
      <div>
        <p className="text-2xl leading-tight font-semibold">
          {Math.round(weather.temperature)}
          {unitSymbol(units)}
        </p>
        <p className="text-sm text-white/50">
          {Math.round(weather.humidity)}% humidity
        </p>
      </div>
    </div>
  );
}
