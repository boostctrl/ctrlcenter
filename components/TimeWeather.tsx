"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useVisitorPrefs } from "./PrefsProvider";
import { shortDate, timeString } from "@/lib/datetime";
import {
  fetchWeather,
  unitSymbol,
  weatherCodeToIcon,
  type CurrentWeather,
} from "@/lib/weather";

// Header widget: live date + clock in the visitor's effective time zone, plus
// the weather when enabled (server-rendered default, re-fetched client-side
// when the visitor's location/units differ).
export default function TimeWeather({
  initialDate,
  weatherEnabled,
  initial,
}: {
  initialDate: string;
  weatherEnabled: boolean;
  initial: CurrentWeather | null;
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

  // Always refetch live on mount (and every 10 min) for the effective location/
  // units, rather than relying on the server-cached SSR seed. This keeps the
  // widget current and in sync with the /weather page, which refetches the same
  // way — the two no longer drift apart on independent 30-min cache windows.
  useEffect(() => {
    if (!weatherEnabled) return;
    let active = true;
    const load = () =>
      fetchWeather(location.latitude, location.longitude, units).then((w) => {
        if (active && w) setFetched(w);
      });
    load();
    const timer = setInterval(load, 10 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [weatherEnabled, location.latitude, location.longitude, units]);

  const weather = fetched ?? initial;
  const time = now ? timeString(now, timezone) : " ";
  const date = now ? shortDate(now, timezone) : initialDate;
  const showWeather = weatherEnabled && weather;

  const inner = (
    <>
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
    </>
  );

  // When weather is on, the widget links to the full forecast.
  return weatherEnabled ? (
    <Link
      href="/weather"
      title="View forecast"
      className="glass-card flex items-center gap-5 px-6 py-4"
    >
      {inner}
    </Link>
  ) : (
    <div className="glass-card flex items-center gap-5 px-6 py-4">{inner}</div>
  );
}
