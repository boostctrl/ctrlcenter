import TimeWeather from "../TimeWeather";
import { StatusSummary } from "../StatusProvider";
import type { CurrentWeather } from "@/lib/weather";

// The combined header card: the time/weather row and the status row sharing one
// glass surface with a hairline divider — exactly the fixed header's card from
// before the widgets became placeable. The card hugs its content and sits at
// the end of its grid cell (sm:ml-auto), matching the old top-right placement.
export default function HeaderCardWidget({
  initialDate,
  initialWeather,
  weatherEnabled,
  showClock,
  statusEnabled,
  apps,
}: {
  initialDate: string;
  initialWeather: CurrentWeather | null;
  weatherEnabled: boolean;
  showClock: boolean;
  statusEnabled: boolean;
  apps: { id: string; name: string }[];
}) {
  const showTimeWeather = showClock || weatherEnabled;
  if (!showTimeWeather && !statusEnabled) return null;
  return (
    <div className="glass-card flex w-full flex-col overflow-hidden sm:ml-auto sm:w-auto">
      {showTimeWeather && (
        <TimeWeather
          initialDate={initialDate}
          weatherEnabled={weatherEnabled}
          showClock={showClock}
          initial={initialWeather}
        />
      )}
      {statusEnabled && <StatusSummary apps={apps} />}
    </div>
  );
}
