import WeatherWidget from "./WeatherWidget";
import HeaderTime from "./HeaderTime";
import { PrefsProvider } from "./PrefsProvider";
import { fetchWeather } from "@/lib/weather";
import { greetingFor } from "@/lib/greeting";
import type { Settings } from "@/lib/schema";

export default async function Header({ settings }: { settings: Settings }) {
  const timeZone = settings.timezone || undefined;
  const now = new Date();

  // Server-computed seed strings (admin default tz) so the SSR'd header has real
  // content before the client applies the visitor's effective timezone.
  const initialDate = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  })
    .format(now)
    .toUpperCase();
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone,
    }).format(now),
    10
  );
  const initialGreeting = greetingFor(hour);

  const weather = settings.weather;
  const initialWeather = weather.enabled
    ? await fetchWeather(weather.latitude, weather.longitude, weather.units)
    : null;

  return (
    <PrefsProvider
      weatherEnabled={weather.enabled}
      defaults={{
        timezone: settings.timezone || "UTC",
        latitude: weather.latitude,
        longitude: weather.longitude,
        units: weather.units,
      }}
    >
      <header className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
        <HeaderTime
          initialDate={initialDate}
          initialGreeting={initialGreeting}
          greetingName={settings.greetingName}
        />
        {weather.enabled && (
          <WeatherWidget
            initial={initialWeather}
            defaultLat={weather.latitude}
            defaultLon={weather.longitude}
            defaultUnits={weather.units}
          />
        )}
      </header>
    </PrefsProvider>
  );
}
