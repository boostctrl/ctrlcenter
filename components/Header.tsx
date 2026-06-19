import WeatherWidget from "./WeatherWidget";
import type { Settings } from "@/lib/schema";

function getGreeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function Header({ settings }: { settings: Settings }) {
  const now = new Date();
  const timeZone = settings.timezone || undefined;

  const dateStr = new Intl.DateTimeFormat("en-US", {
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

  const greeting = getGreeting(hour);

  return (
    <header className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
      <div>
        <p className="text-sm font-medium tracking-widest text-white/40">{dateStr}</p>
        <h1 className="mt-2 text-5xl font-bold tracking-tight sm:text-6xl">
          {greeting}
          {settings.greetingName ? `, ${settings.greetingName}` : ""}
          <span className="gradient-text">!</span>
        </h1>
      </div>
      {settings.weather.enabled && <WeatherWidget weather={settings.weather} />}
    </header>
  );
}
