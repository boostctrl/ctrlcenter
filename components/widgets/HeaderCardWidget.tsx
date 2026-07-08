import TimeWeather from "../TimeWeather";
import { StatusSummary } from "../StatusProvider";
import type { CurrentWeather } from "@/lib/weather";

// The combined header card: the time/weather row and the status row sharing
// one glass surface with a hairline divider — the fixed header's card from
// before the widgets became placeable. The card fills its grid cell so the
// editor's span stepper visibly resizes it; `@container` lets the inner
// time/weather row adapt to the cell's actual width (side by side when wide,
// stacked when narrow) instead of clipping.
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
  // Status alone in the combined card used to render as a bare sliver of a
  // pill (#105); the standalone status card is that exact state done right,
  // so degrade into it.
  if (!showTimeWeather) return <StatusSummary apps={apps} variant="card" />;
  return (
    <div className="glass-card @container flex w-full flex-col overflow-hidden">
      <TimeWeather
        initialDate={initialDate}
        weatherEnabled={weatherEnabled}
        showClock={showClock}
        initial={initialWeather}
      />
      {statusEnabled && <StatusSummary apps={apps} />}
    </div>
  );
}
