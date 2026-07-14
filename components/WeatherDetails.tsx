"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import { useEdgeFade } from "./useEdgeFade";
import WeatherEffects from "./WeatherEffects";
import {
  fetchForecast,
  unitSymbol,
  windUnitLabel,
  precipUnitLabel,
  windDirectionLabel,
  uvLabel,
  formatClock,
  weatherCodeToIcon,
  weatherCodeLabel,
  type Forecast,
} from "@/lib/weather";

// Times come back in the location's own timezone as "YYYY-MM-DDTHH:MM", so read
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

function minutesOfDay(iso: string): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// A subtle, accent-derived wash for the hero that shifts with the conditions and
// day/night — bright top wash for clear day, deeper/cooler at night, muted under
// storms/overcast. Built from --accent-from so it still honors the active theme.
function conditionWash(code: number, isDay: boolean): string {
  const a = (pct: number) =>
    `color-mix(in srgb, var(--accent-from) ${pct}%, transparent)`;
  if (!isDay)
    return `radial-gradient(130% 90% at 50% 120%, ${a(22)}, transparent 72%)`;
  if (code === 0 || code === 1)
    return `radial-gradient(130% 95% at 50% -25%, ${a(30)}, transparent 60%)`;
  if (code === 95 || code === 96 || code === 99)
    return `radial-gradient(110% 90% at 30% 115%, ${a(16)}, transparent 72%)`;
  if (code >= 71 && code <= 86)
    return `radial-gradient(130% 95% at 50% -15%, ${a(24)}, transparent 62%)`;
  if (code >= 51 && code <= 82)
    return `radial-gradient(130% 90% at 50% -10%, ${a(16)}, transparent 66%)`;
  return `radial-gradient(130% 90% at 50% -15%, ${a(11)}, transparent 64%)`;
}

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="glass-card flex flex-col gap-1 p-4">
      <span className="text-xs tracking-wide text-fg/45 uppercase">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      {sub != null && <span className="text-xs text-fg/45">{sub}</span>}
    </div>
  );
}

// Wind direction arrow — points the way the wind blows (meteorological direction
// is where it comes *from*, so rotate by +180).
function WindArrow({ deg }: { deg: number }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      className="shrink-0"
      style={{ transform: `rotate(${deg + 180}deg)`, color: "var(--accent-from)" }}
      aria-hidden
    >
      <path d="M12 2 L18 20 L12 16 L6 20 Z" fill="currentColor" />
    </svg>
  );
}

// Sunrise → sunset arc with the sun positioned by the current local time.
function SunArc({
  sunrise,
  sunset,
  nowMin,
}: {
  sunrise: string;
  sunset: string;
  nowMin: number | null;
}) {
  const sr = minutesOfDay(sunrise);
  const ss = minutesOfDay(sunset);
  let frac: number | null = null;
  if (sr != null && ss != null && nowMin != null && ss > sr) {
    frac = Math.min(1, Math.max(0, (nowMin - sr) / (ss - sr)));
  }
  const angle = frac != null ? Math.PI * (1 - frac) : null;
  const sunX = angle != null ? 100 + 90 * Math.cos(angle) : null;
  const sunY = angle != null ? 80 - 70 * Math.sin(angle) : null;

  return (
    <div className="glass-card flex flex-col p-5">
      <span className="mb-2 text-xs font-semibold tracking-[0.18em] text-fg/50 uppercase">
        Sun
      </span>
      <svg viewBox="0 0 200 92" className="w-full" aria-hidden>
        <path
          d="M10,80 A90,70 0 0 1 190,80"
          fill="none"
          stroke="color-mix(in srgb, var(--accent-from) 30%, transparent)"
          strokeWidth="2"
          strokeDasharray="3 4"
        />
        <line
          x1="6"
          y1="80"
          x2="194"
          y2="80"
          stroke="color-mix(in srgb, var(--fg) 12%, transparent)"
        />
        {sunX != null && sunY != null && (
          <circle
            cx={sunX}
            cy={sunY}
            r="6"
            fill="var(--accent-from)"
            style={{ filter: "drop-shadow(0 0 6px var(--accent-from))" }}
          />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-sm">
        <div>
          <p className="text-fg/45 text-xs">Sunrise</p>
          <p className="font-medium tabular-nums">{formatClock(sunrise)}</p>
        </div>
        <div className="text-right">
          <p className="text-fg/45 text-xs">Sunset</p>
          <p className="font-medium tabular-nums">{formatClock(sunset)}</p>
        </div>
      </div>
    </div>
  );
}

// The forecast view for /weather: rich current conditions, the next 24 hours, and
// a 7-day outlook for the visitor's effective location/units (seeded server-side
// with the admin default, re-fetched when the visitor's differs).
export default function WeatherDetails({
  initial,
}: {
  initial: Forecast | null;
}) {
  const { location, units, surfaceIsLight } = useVisitorPrefs();
  const [fetched, setFetched] = useState<Forecast | null>(null);
  const [nowMin, setNowMin] = useState<number | null>(null);

  // Always refetch live on mount (and every 10 min) so the page stays current and
  // in sync with the header widget.
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

  // Local minute-of-day for the sun arc, after mount (avoids SSR/clock mismatch).
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);

  // Fade the hourly strip's clipped edge like the app's other scrollers (#143).
  const {
    ref: hourlyRef,
    onScroll: onHourlyScroll,
    style: hourlyStyle,
  } = useEdgeFade<HTMLDivElement>();

  const forecast = fetched ?? initial;
  if (!forecast) {
    return <p className="text-fg/50">Couldn&apos;t load the forecast.</p>;
  }

  const sym = unitSymbol(units);
  const windUnit = windUnitLabel(units);
  const { current, hourly, daily } = forecast;
  const today = daily[0];

  const weekMin = Math.min(...daily.map((d) => d.min));
  const weekMax = Math.max(...daily.map((d) => d.max));
  const span = Math.max(1, weekMax - weekMin);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Hero */}
        <div className="glass-card relative overflow-hidden p-6 lg:col-span-2">
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: conditionWash(current.code, current.isDay) }}
            aria-hidden
          />
          <WeatherEffects
            code={current.code}
            isDay={current.isDay}
            light={surfaceIsLight}
          />
          <div className="relative flex flex-wrap items-center gap-x-6 gap-y-3">
            <span className="text-7xl leading-none" aria-hidden>
              {weatherCodeToIcon(current.code)}
            </span>
            <div>
              <p className="text-6xl font-bold tracking-tight tabular-nums">
                {Math.round(current.temperature)}
                {sym}
              </p>
              <p className="mt-1 text-fg/70">
                {weatherCodeLabel(current.code)} · Feels like{" "}
                {Math.round(current.feelsLike)}
                {sym}
              </p>
              {location.label && (
                <p className="text-sm text-fg/45">{location.label}</p>
              )}
            </div>
          </div>
        </div>

        {/* Sun arc */}
        {today && (
          <SunArc sunrise={today.sunrise} sunset={today.sunset} nowMin={nowMin} />
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatTile
          label="Wind"
          value={
            <span className="flex items-center gap-1.5">
              <WindArrow deg={current.windDirection} />
              {Math.round(current.windSpeed)}{" "}
              <span className="text-sm font-normal text-fg/50">{windUnit}</span>
            </span>
          }
          sub={`${windDirectionLabel(current.windDirection)} · gusts ${Math.round(
            current.windGusts
          )}`}
        />
        <StatTile
          label="Chance of precip"
          value={`${current.precipProbability}%`}
          sub={today ? `${today.precipProbabilityMax}% today` : undefined}
        />
        <StatTile
          label="Precipitation"
          value={
            <>
              {current.precipitation.toFixed(1)}{" "}
              <span className="text-sm font-normal text-fg/50">
                {precipUnitLabel(units)}
              </span>
            </>
          }
        />
        <StatTile label="Humidity" value={`${Math.round(current.humidity)}%`} />
        <StatTile
          label="UV index"
          value={Math.round(current.uvIndex)}
          sub={uvLabel(current.uvIndex)}
        />
        <StatTile
          label="Feels like"
          value={`${Math.round(current.feelsLike)}${sym}`}
        />
        <StatTile label="Cloud cover" value={`${Math.round(current.cloudCover)}%`} />
        <StatTile
          label="Pressure"
          value={
            <>
              {Math.round(current.pressure)}{" "}
              <span className="text-sm font-normal text-fg/50">hPa</span>
            </>
          }
        />
      </div>

      {/* Next 24 hours */}
      {hourly.length > 0 && (
        <div className="glass-card p-5">
          <h2 className="mb-3 text-xs font-semibold tracking-[0.18em] text-fg/50 uppercase">
            Hourly forecast
          </h2>
          <div
            ref={hourlyRef}
            onScroll={onHourlyScroll}
            style={hourlyStyle}
            className="flex gap-4 overflow-x-auto pb-1"
          >
            {hourly.map((h) => (
              <div
                key={h.time}
                className="flex shrink-0 grow flex-col items-center gap-1 text-center"
              >
                <span className="text-xs text-fg/50">{hourLabel(h.time)}</span>
                <span className="text-xl" aria-hidden>
                  {weatherCodeToIcon(h.code)}
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {Math.round(h.temperature)}
                  {sym}
                </span>
                <span
                  className="text-[11px] tabular-nums text-fg/40"
                  style={{ visibility: h.precipProbability > 0 ? "visible" : "hidden" }}
                >
                  {h.precipProbability}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7-day */}
      {daily.length > 0 && (
        <div className="glass-card p-5">
          <h2 className="mb-2 text-xs font-semibold tracking-[0.18em] text-fg/50 uppercase">
            7-day forecast
          </h2>
          <ul className="divide-y divide-fg/10">
            {daily.map((d, i) => {
              const lo = ((d.min - weekMin) / span) * 100;
              const hi = ((d.max - weekMin) / span) * 100;
              return (
                <li key={d.date} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="w-12 shrink-0 text-fg/70">
                    {dayLabel(d.date, i)}
                  </span>
                  <span className="w-6 shrink-0 text-center text-lg" aria-hidden>
                    {weatherCodeToIcon(d.code)}
                  </span>
                  <span className="hidden w-10 shrink-0 text-right text-xs tabular-nums text-fg/45 sm:block">
                    {d.precipProbabilityMax > 0 ? `${d.precipProbabilityMax}%` : ""}
                  </span>
                  <span className="shrink-0 text-right tabular-nums text-fg/40">
                    {Math.round(d.min)}°
                  </span>
                  <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-fg/10">
                    <span
                      className="absolute inset-y-0 rounded-full"
                      style={{
                        left: `${lo}%`,
                        right: `${100 - hi}%`,
                        background:
                          "linear-gradient(to right, var(--accent-from), var(--accent-to))",
                      }}
                    />
                  </span>
                  <span className="shrink-0 text-right font-medium tabular-nums">
                    {Math.round(d.max)}°
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
