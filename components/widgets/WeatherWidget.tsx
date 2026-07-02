import TimeWeather from "../TimeWeather";
import type { CurrentWeather } from "@/lib/weather";

// A standalone current-conditions card — the header card's weather block on its
// own glass surface, linking to the /weather page like the combined card does.
// If an admin places this AND the combined card, each TimeWeather instance
// refetches Open-Meteo on its own 10-minute cycle; two placed weather widgets
// simply cost one extra periodic fetch.
export default function WeatherWidget({
  initialWeather,
  weatherEnabled,
}: {
  initialWeather: CurrentWeather | null;
  weatherEnabled: boolean;
}) {
  if (!weatherEnabled) return null;
  return (
    <div className="glass-card flex w-full flex-col overflow-hidden sm:w-auto sm:self-start">
      <TimeWeather
        initialDate=""
        weatherEnabled
        showClock={false}
        initial={initialWeather}
      />
    </div>
  );
}
