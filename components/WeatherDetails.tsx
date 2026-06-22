"use client";

import { useEffect, useState } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import {
  fetchForecast,
  unitSymbol,
  weatherCodeToIcon,
  weatherCodeLabel,
  type Forecast,
} from "@/lib/weather";

// Times come back in the location's own timezone as "YYYY-MM-DDTHH:MM", so format
// straight from the string to avoid reinterpreting them in the browser's zone.
function hourLabel(t: string): string {
  const hh = Number(t.slice(11, 13));
  return `${hh % 12 || 12} ${hh < 12 ? "AM" : "PM"}`;
}

function dayLabel(d: string, i: number): string {
  if (i === 0) return "Today";
  return new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
  });
}

// The forecast view for /weather: current conditions, the next 24 hours, and a
// 7-day outlook for the visitor's effective location/units (seeded server-side
// with the admin default, re-fetched when the visitor's differs — like the
// header widget).
export default function WeatherDetails({
  initial,
}: {
  initial: Forecast | null;
}) {
  const { location, units } = useVisitorPrefs();
  const [fetched, setFetched] = useState<Forecast | null>(null);

  // Always refetch live on mount (and every 10 min) so the page stays current
  // and in sync with the header widget, which refetches the same way — rather
  // than serving a drifted 30-min server-cached snapshot.
  useEffect(() => {
    let active = true;
    const load = () =>
      fetchForecast(location.latitude, location.longitude, units).then((f) => {
        if (active && f) setFetched(f);
      });
    load();
    const timer = setInterval(load, 10 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [location.latitude, location.longitude, units]);

  const forecast = fetched ?? initial;
  if (!forecast) {
    return <p className="text-fg/50">Couldn&apos;t load the forecast.</p>;
  }

  const sym = unitSymbol(units);
  const { current, hourly, daily } = forecast;

  return (
    <div className="space-y-6">
      {location.label && (
        <p className="-mt-4 text-sm text-fg/50">{location.label}</p>
      )}

      <div className="glass-card flex items-center gap-5 p-6">
        <span className="text-6xl" aria-hidden>
          {weatherCodeToIcon(current.code)}
        </span>
        <div>
          <p className="text-5xl font-bold">
            {Math.round(current.temperature)}
            {sym}
          </p>
          <p className="text-fg/60">
            {weatherCodeLabel(current.code)} · {Math.round(current.humidity)}%
            humidity
          </p>
        </div>
      </div>

      {hourly.length > 0 && (
        <div className="glass-card p-5">
          <h2 className="mb-3 text-xs font-semibold tracking-[0.18em] text-fg/50 uppercase">
            Next 24 hours
          </h2>
          <div className="flex gap-5 overflow-x-auto pb-1">
            {hourly.map((h) => (
              <div
                key={h.time}
                className="flex shrink-0 flex-col items-center gap-1 text-center"
              >
                <span className="text-xs text-fg/50">{hourLabel(h.time)}</span>
                <span className="text-xl" aria-hidden>
                  {weatherCodeToIcon(h.code)}
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {Math.round(h.temperature)}
                  {sym}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {daily.length > 0 && (
        <div className="glass-card p-5">
          <h2 className="mb-2 text-xs font-semibold tracking-[0.18em] text-fg/50 uppercase">
            7-day forecast
          </h2>
          <ul className="divide-y divide-fg/10">
            {daily.map((d, i) => (
              <li
                key={d.date}
                className="flex items-center gap-4 py-2.5 text-sm"
              >
                <span className="w-14 shrink-0 text-fg/70">
                  {dayLabel(d.date, i)}
                </span>
                <span className="text-xl" aria-hidden>
                  {weatherCodeToIcon(d.code)}
                </span>
                <span className="flex-1 truncate text-fg/50">
                  {weatherCodeLabel(d.code)}
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-medium">
                    {Math.round(d.max)}
                    {sym}
                  </span>{" "}
                  <span className="text-fg/40">
                    {Math.round(d.min)}
                    {sym}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
