"use client";

import { useEffect, useState } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import { shortDate, timeString } from "@/lib/datetime";
import {
  fetchWeather,
  unitSymbol,
  weatherCodeToIcon,
  type CurrentWeather,
  type Units,
} from "@/lib/weather";

// Header widget: live date + clock in the visitor's effective time zone, plus
// the weather when enabled (server-rendered default, re-fetched client-side
// when the visitor's location/units differ).
export default function TimeWeather({
  initialDate,
  weatherEnabled,
  initial,
  defaultLat,
  defaultLon,
  defaultUnits,
}: {
  initialDate: string;
  weatherEnabled: boolean;
  initial: CurrentWeather | null;
  defaultLat: number;
  defaultLon: number;
  defaultUnits: Units;
}) {
  const { timezone, location, units } = useVisitorPrefs();
  const [now, setNow] = useState<Date | null>(null);
  const [fetched, setFetched] = useState<CurrentWeather | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, []);

  const usesDefault =
    Math.abs(location.latitude - defaultLat) < 1e-4 &&
    Math.abs(location.longitude - defaultLon) < 1e-4 &&
    units === defaultUnits;

  useEffect(() => {
    if (!weatherEnabled || usesDefault) return;
    let active = true;
    fetchWeather(location.latitude, location.longitude, units).then((w) => {
      if (active) setFetched(w);
    });
    return () => {
      active = false;
    };
  }, [weatherEnabled, usesDefault, location.latitude, location.longitude, units]);

  const weather = usesDefault ? initial : (fetched ?? initial);
  const time = now ? timeString(now, timezone) : " ";
  const date = now ? shortDate(now, timezone) : initialDate;
  const showWeather = weatherEnabled && weather;

  return (
    <div className="glass-card flex items-center gap-5 px-6 py-4">
      {showWeather && (
        <>
          <div className="flex items-center gap-3">
            <span className="text-4xl" aria-hidden>
              {weatherCodeToIcon(weather.code)}
            </span>
            <div>
              <p className="text-2xl leading-tight font-semibold">
                {Math.round(weather.temperature)}
                {unitSymbol(units)}
              </p>
              <p className="text-xs text-fg/50">
                {Math.round(weather.humidity)}% humidity
              </p>
            </div>
          </div>
          <div className="h-10 w-px bg-fg/10" />
        </>
      )}
      <div className="text-right">
        <p
          className="text-2xl leading-tight font-semibold tabular-nums"
          suppressHydrationWarning
        >
          {time}
        </p>
        <p className="text-xs tracking-wide text-fg/50" suppressHydrationWarning>
          {date}
          {weatherEnabled && location.label ? ` · ${location.label}` : ""}
        </p>
      </div>
    </div>
  );
}
