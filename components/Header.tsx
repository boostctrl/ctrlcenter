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

  const { greeting: showGreeting, clock: showClock } = settings.components;
  // The time/weather row renders when either the clock or weather is on; the
  // glass card renders when that row or the status row has something to show.
  const showTimeWeather = showClock || weather.enabled;
  const showCard = showTimeWeather || statusEnabled;

  return (
    <header className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
      {showGreeting && <Greeting initialGreeting={initialGreeting} />}
      {showCard && (
        <div
          className={`glass-card flex w-full flex-col overflow-hidden sm:w-auto${
            showGreeting ? "" : " sm:ml-auto"
          }`}
        >
          {showTimeWeather && (
            <TimeWeather
              initialDate={initialDate}
              weatherEnabled={weather.enabled}
              showClock={showClock}
              initial={initialWeather}
            />
          )}
          {statusEnabled && <StatusSummary apps={apps} />}
        </div>
      )}
    </header>
  );
}
