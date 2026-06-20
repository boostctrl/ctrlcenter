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

export function unitSymbol(units: Units): string {
  return units === "metric" ? "°C" : "°F";
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
