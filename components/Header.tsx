import Greeting from "./Greeting";
import TimeWeather from "./TimeWeather";
import { StatusSummary } from "./StatusProvider";
import { fetchWeather } from "@/lib/weather";
import { greetingFor, hourIn, shortDate } from "@/lib/datetime";
import type { AppItem, Settings } from "@/lib/schema";

export default async function Header({
  settings,
  apps,
  statusEnabled,
}: {
  settings: Settings;
  apps: AppItem[];
  statusEnabled: boolean;
}) {
  const timeZone = settings.timezone || undefined;
  const now = new Date();

  // Server-computed seeds (admin default tz) so the SSR'd header has real
  // content before the client applies the visitor's effective timezone.
  const initialDate = shortDate(now, timeZone ?? "UTC");
  const initialGreeting = greetingFor(hourIn(now, timeZone ?? "UTC"));

  const weather = settings.weather;
  const initialWeather = weather.enabled
    ? await fetchWeather(weather.latitude, weather.longitude, weather.units)
    : null;

  return (
    <header className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
      <Greeting initialGreeting={initialGreeting} />
      <div className="glass-card flex w-full flex-col overflow-hidden sm:w-auto">
        <TimeWeather
          initialDate={initialDate}
          weatherEnabled={weather.enabled}
          initial={initialWeather}
        />
        {statusEnabled && <StatusSummary apps={apps} />}
      </div>
    </header>
  );
}
