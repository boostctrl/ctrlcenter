import type { Settings } from "@/lib/schema";

type WeatherSettings = Settings["weather"];

type CurrentWeather = {
  temperature_2m: number;
  relative_humidity_2m: number;
  weather_code: number;
};

async function fetchWeather(weather: WeatherSettings): Promise<CurrentWeather | null> {
  const params = new URLSearchParams({
    latitude: String(weather.latitude),
    longitude: String(weather.longitude),
    current: "temperature_2m,relative_humidity_2m,weather_code",
    temperature_unit: weather.units === "metric" ? "celsius" : "fahrenheit",
    timezone: "auto",
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    next: { revalidate: 1800 },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.current as CurrentWeather;
}

function weatherCodeToIcon(code: number): string {
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

export default async function WeatherWidget({ weather }: { weather: WeatherSettings }) {
  const current = await fetchWeather(weather).catch(() => null);
  if (!current) return null;

  const unitSymbol = weather.units === "metric" ? "°C" : "°F";

  return (
    <div className="glass-card flex items-center gap-4 px-6 py-4">
      <span className="text-4xl" aria-hidden>
        {weatherCodeToIcon(current.weather_code)}
      </span>
      <div>
        <p className="text-2xl leading-tight font-semibold">
          {Math.round(current.temperature_2m)}
          {unitSymbol}
        </p>
        <p className="text-sm text-white/50">
          {Math.round(current.relative_humidity_2m)}% humidity
        </p>
      </div>
    </div>
  );
}
