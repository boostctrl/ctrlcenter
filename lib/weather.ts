// Shared Open-Meteo weather fetch + presentation helpers. Used both server-side
// (to render the admin-default location into the initial HTML) and client-side
// (to re-fetch when a visitor's detected/overridden location differs).
import { log, hostOf, errorReason } from "./log";

export type Units = "imperial" | "metric";

// Cap every weather request so an unresponsive Open-Meteo can't hang the
// server-rendered home page (or the /weather page) — without this the fetch has
// no timeout and blocks the render until the socket eventually gives up. Kept
// short: weather is a nice-to-have that the widget also re-fetches client-side,
// so on a timeout the fetch aborts, we return null, and the page renders now
// with the widget filling in (or hiding) rather than waiting on a slow upstream.
const WEATHER_TIMEOUT_MS = 3000;

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

  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      // Server-side, cache for 30 min; the option is ignored in the browser.
      next: { revalidate: 1800 },
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn("weather fetch failed", { host: hostOf(url), status: res.status });
      return null;
    }
    const data = await res.json();
    const current = data.current;
    if (!current) return null;
    // Guard the fields like fetchForecast does: bail if the API omits a required
    // numeric (so the widget hides rather than rendering NaN°), and coerce the
    // rest.
    if (
      typeof current.temperature_2m !== "number" ||
      typeof current.weather_code !== "number"
    ) {
      return null;
    }
    return {
      temperature: current.temperature_2m,
      humidity:
        typeof current.relative_humidity_2m === "number"
          ? current.relative_humidity_2m
          : 0,
      code: current.weather_code,
    };
  } catch (e) {
    log.warn("weather fetch error", { host: hostOf(url), reason: errorReason(e) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// The fuller current conditions shown on the /weather page (the header widget
// uses the lean CurrentWeather above). uvIndex / precipProbability come from the
// current hour of the hourly series (Open-Meteo has no "current" field for them).
export type CurrentDetail = CurrentWeather & {
  feelsLike: number;
  isDay: boolean;
  cloudCover: number;
  pressure: number;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
  precipitation: number;
  precipProbability: number;
  uvIndex: number;
  visibility: number; // metres (Open-Meteo); converted for display
};

// A single hour / day in the forecast. Times are ISO strings in the location's
// own timezone (Open-Meteo timezone=auto), without an offset suffix.
export type HourPoint = {
  time: string;
  temperature: number;
  code: number;
  precipProbability: number;
  isDay: boolean;
};
export type DayPoint = {
  date: string;
  code: number;
  max: number;
  min: number;
  precipProbabilityMax: number;
  uvIndexMax: number;
  windMax: number;
  sunrise: string;
  sunset: string;
};
export type Forecast = {
  current: CurrentDetail;
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
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation",
    hourly:
      "temperature_2m,weather_code,precipitation_probability,is_day,uv_index,visibility",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max,wind_speed_10m_max",
    temperature_unit: units === "metric" ? "celsius" : "fahrenheit",
    wind_speed_unit: units === "metric" ? "kmh" : "mph",
    precipitation_unit: units === "metric" ? "mm" : "inch",
    timezone: "auto",
    forecast_days: "7",
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn("forecast fetch failed", { host: hostOf(url), status: res.status });
      return null;
    }
    const data = await res.json();
    const current = data.current;
    const h = data.hourly;
    const d = data.daily;
    if (!current || !h || !d) return null;

    const num = (v: unknown): number => (typeof v === "number" ? v : 0);

    // Trim the hourly series to the next 24 hours from "now".
    const startRaw = h.time.findIndex((t: string) => t >= current.time);
    const start = startRaw === -1 ? 0 : startRaw;
    const hourly: HourPoint[] = h.time
      .slice(start, start + 24)
      .map((time: string, i: number) => ({
        time,
        temperature: h.temperature_2m[start + i],
        code: h.weather_code[start + i],
        precipProbability: num(h.precipitation_probability?.[start + i]),
        isDay: num(h.is_day?.[start + i]) === 1,
      }));

    const daily: DayPoint[] = d.time.map((date: string, i: number) => ({
      date,
      code: d.weather_code[i],
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      precipProbabilityMax: num(d.precipitation_probability_max?.[i]),
      uvIndexMax: num(d.uv_index_max?.[i]),
      windMax: num(d.wind_speed_10m_max?.[i]),
      sunrise: d.sunrise?.[i] ?? "",
      sunset: d.sunset?.[i] ?? "",
    }));

    return {
      current: {
        temperature: current.temperature_2m,
        humidity: num(current.relative_humidity_2m),
        code: current.weather_code,
        feelsLike: num(current.apparent_temperature),
        isDay: num(current.is_day) === 1,
        cloudCover: num(current.cloud_cover),
        pressure: num(current.pressure_msl),
        windSpeed: num(current.wind_speed_10m),
        windDirection: num(current.wind_direction_10m),
        windGusts: num(current.wind_gusts_10m),
        precipitation: num(current.precipitation),
        precipProbability: num(h.precipitation_probability?.[start]),
        uvIndex: num(h.uv_index?.[start]),
        visibility: num(h.visibility?.[start]),
      },
      hourly,
      daily,
    };
  } catch (e) {
    log.warn("forecast fetch error", { host: hostOf(url), reason: errorReason(e) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function unitSymbol(units: Units): string {
  return units === "metric" ? "°C" : "°F";
}

export function windUnitLabel(units: Units): string {
  return units === "metric" ? "km/h" : "mph";
}

export function precipUnitLabel(units: Units): string {
  return units === "metric" ? "mm" : "in";
}

const COMPASS_16 = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

// Meteorological wind direction (degrees the wind blows *from*) → 16-point
// compass abbreviation.
export function windDirectionLabel(deg: number): string {
  const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS_16[i];
}

// UV index severity band (WHO scale).
export function uvLabel(uv: number): string {
  if (uv < 3) return "Low";
  if (uv < 6) return "Moderate";
  if (uv < 8) return "High";
  if (uv < 11) return "Very high";
  return "Extreme";
}

// Format an Open-Meteo local time string ("YYYY-MM-DDTHH:MM") as a 12-hour clock
// (e.g. "6:42 AM"), reading the digits directly so the location's own timezone is
// preserved rather than reinterpreted in the browser's zone.
export function formatClock(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return "—";
  const hh = Number(m[1]);
  const h12 = hh % 12 || 12;
  return `${h12}:${m[2]} ${hh < 12 ? "AM" : "PM"}`;
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
