// Shared Open-Meteo weather fetch + presentation helpers. Used both server-side
// (to render the admin-default location into the initial HTML) and client-side
// (to re-fetch when a visitor's detected/overridden location differs).
export type Units = "imperial" | "metric";

export type CurrentWeather = {
  temperature: number;
  humidity: number;
  code: number;
};

export async function fetchWeather(
  latitude: number,
  longitude: number,
  units: Units
): Promise<CurrentWeather | null> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,relative_humidity_2m,weather_code",
    temperature_unit: units === "metric" ? "celsius" : "fahrenheit",
    timezone: "auto",
  });

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      // Server-side, cache for 30 min; the option is ignored in the browser.
      next: { revalidate: 1800 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const current = data.current;
    if (!current) return null;
    return {
      temperature: current.temperature_2m,
      humidity: current.relative_humidity_2m,
      code: current.weather_code,
    };
  } catch {
    return null;
  }
}

// A single hour / day in the forecast. Times are ISO strings in the location's
// own timezone (Open-Meteo timezone=auto), without an offset suffix.
export type HourPoint = { time: string; temperature: number; code: number };
export type DayPoint = { date: string; code: number; max: number; min: number };
export type Forecast = {
  current: CurrentWeather;
  hourly: HourPoint[];
  daily: DayPoint[];
};

// Fuller forecast for the /weather page: current conditions, the next 24 hours,
// and a 7-day outlook.
export async function fetchForecast(
  latitude: number,
  longitude: number,
  units: Units
): Promise<Forecast | null> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,relative_humidity_2m,weather_code",
    hourly: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    temperature_unit: units === "metric" ? "celsius" : "fahrenheit",
    timezone: "auto",
    forecast_days: "7",
  });

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      next: { revalidate: 1800 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const current = data.current;
    const h = data.hourly;
    const d = data.daily;
    if (!current || !h || !d) return null;

    // Trim the hourly series to the next 24 hours from "now".
    const startRaw = h.time.findIndex((t: string) => t >= current.time);
    const start = startRaw === -1 ? 0 : startRaw;
    const hourly: HourPoint[] = h.time
      .slice(start, start + 24)
      .map((time: string, i: number) => ({
        time,
        temperature: h.temperature_2m[start + i],
        code: h.weather_code[start + i],
      }));

    const daily: DayPoint[] = d.time.map((date: string, i: number) => ({
      date,
      code: d.weather_code[i],
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
    }));

    return {
      current: {
        temperature: current.temperature_2m,
        humidity: current.relative_humidity_2m,
        code: current.weather_code,
      },
      hourly,
      daily,
    };
  } catch {
    return null;
  }
}

export function unitSymbol(units: Units): string {
  return units === "metric" ? "°C" : "°F";
}

// Short text label for a weather code (for the forecast page).
export function weatherCodeLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if ([51, 53, 55].includes(code)) return "Drizzle";
  if ([56, 57].includes(code)) return "Freezing drizzle";
  if ([61, 63, 65].includes(code)) return "Rain";
  if ([66, 67].includes(code)) return "Freezing rain";
  if ([80, 81, 82].includes(code)) return "Rain showers";
  if ([71, 73, 75, 77].includes(code)) return "Snow";
  if ([85, 86].includes(code)) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if ([96, 99].includes(code)) return "Thunderstorm with hail";
  return "—";
}

export function weatherCodeToIcon(code: number): string {
  if (code === 0) return "☀️";
  if (code === 1 || code === 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if ([51, 53, 55, 56, 57].includes(code)) return "🌦️";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "🌧️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "🌡️";
}
